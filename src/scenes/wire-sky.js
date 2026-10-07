import { sceneBirdId, birdVariation } from '../scene-contract.js';
import { laneFor, LANES } from './perches.js';

const TAU = Math.PI * 2, STEP = 1000 / 60, MAX_BIRDS = 2400, CELL = .22;
// Travel has its own clock so brisk passes do not speed up wingbeats or glides.
const FLIGHT_RATE = 3;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const validSize = value => Number.isFinite(value) && value > 0;

// A compact circling flock with individual response delays and personal space.
// This is an illustrative pigeon model, not a calibrated flight simulation.
// Shape/circling: https://www.allaboutbirds.org/guide/Rock_Pigeon/id
// Travel reference: https://www.youtube.com/watch?v=-rWgPueiiNo
// Wingbeats: https://doi.org/10.1371/journal.pbio.3000299
export function createWireSky({ width = 1200, height = 800 } = {}) {
  if (![width, height].every(validSize)) throw new TypeError('Scene dimensions must be positive numbers.');
  const frame = { birds: [], geometry: [], width, height, time: 0,
    counts: Object.fromEntries(LANES.map(lane => [lane, { total: 0, visible: 0, overflow: 0 }])) };
  const flock = new Map(), seenEvents = new Map(), grid = new Map();
  let states = [], reducedMotion = false, disposed = false, motionTime = 0, flightTime = 0;
  let environment = {}, initialized = false;

  // Broad circuits, slight changes in radius/altitude, a near and a receding pass.
  function route(seconds) {
    const angle = seconds * .29 - .9 + Math.sin(seconds * .11) * .13;
    return { x: Math.cos(angle) * (.62 + Math.sin(seconds * .09) * .05),
      y: Math.sin(angle) * .48, z: Math.sin(angle * .8) * .08 + Math.sin(seconds * .17) * .035 };
  }
  function variation(id) {
    const v = birdVariation(id);
    let hash = 2166136261;
    for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    const random = () => { hash ^= hash << 13; hash ^= hash >>> 17; hash ^= hash << 5; return (hash >>> 0) / 4294967296; };
    return { ...v, ox: (random() - .5) * .30, oy: (random() - .5) * .25,
      oz: (random() - .5) * .17, delay: .10 + random() * .65,
      frequency: 5.7 + random() * .8, glidePeriod: 8 + random() * 4 };
  }
  function projectPoint(x, y, z) {
    const top = width < 640 ? 200 : 175;
    const bottom = height - (width < 640 ? 310 : 235);
    const availableHeight = Math.max(120, bottom - top);
    const perspective = 1 / (1 + y * .32);
    return { x: width / 2 + x * Math.max(60, width * .39) * perspective,
      y: top + availableHeight / 2 + (y * .34 - z * .86) * availableHeight,
      perspective };
  }
  function project(dt = 0) {
    frame.birds.length = 0;
    for (const state of states) {
      const bird = state.view, v = state.variation;
      const point = projectPoint(state.x, state.y, state.z);
      const ahead = projectPoint(state.x + state.vx * .05, state.y + state.vy * .05, state.z + state.vz * .05);
      const heading = Math.atan2(ahead.y - point.y, ahead.x - point.x);
      if (dt > 0) {
        const turn = Math.atan2(Math.sin(heading - bird.heading), Math.cos(heading - bird.heading));
        const targetBank = clamp(turn / dt * .38, -.85, .85);
        bird.bank += (targetBank - bird.bank) * (1 - Math.exp(-dt * 7));
      }
      bird.heading = heading; bird.x = point.x; bird.y = point.y; bird.depth = state.y;
      bird.size = (width < 640 ? 7.8 : 9.7) * point.perspective * v.scale;
      bird.wingPhase = motionTime / 1000 * TAU * v.frequency + v.phase;
      const cycle = (motionTime / 1000 + v.glideOffset) % v.glidePeriod;
      bird.pose = cycle > v.glidePeriod - .38 ? 'gliding' : 'flying';
      bird.activity = reducedMotion ? 0 : clamp((state.activityUntil - motionTime) / 1800, 0, 1);
      bird.alpha = clamp(.87 - state.y * .22, .60, 1);
      frame.birds.push(bird);
    }
    frame.birds.sort((a, b) => b.depth - a.depth);
  }
  const gridKey = (x, y, z) => `${x},${y},${z}`;
  function step(dt) {
    grid.clear();
    for (const state of states) {
      const key = gridKey(Math.floor(state.x / CELL), Math.floor(state.y / CELL), Math.floor(state.z / CELL));
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(state);
    }
    const seconds = flightTime / 1000;
    const weather = environment.weather?.expiresAt > Date.now() ? environment.weather : null;
    const windSpeed = clamp(Number.isFinite(weather?.windKph) ? weather.windKph : 0, 0, 60) / 1000;
    // Meteorological direction names the direction wind comes FROM.
    const windAngle = (Number.isFinite(weather?.windDirection) ? weather.windDirection : 0) * Math.PI / 180;
    const windX = -Math.sin(windAngle) * windSpeed, windY = Math.cos(windAngle) * windSpeed;
    for (const state of states) {
      const v = state.variation;
      const guide = route(seconds - v.delay + .55), future = route(seconds - v.delay + .65);
      const breath = 1 + Math.sin(seconds * .6 + v.phase) * .12;
      let desiredX = (future.x - guide.x) * 10 + (guide.x + v.ox * breath - state.x) * .90;
      let desiredY = (future.y - guide.y) * 10 + (guide.y + v.oy * breath - state.y) * .90;
      let desiredZ = (future.z - guide.z) * 10 + (guide.z + v.oz - state.z) * 1.1;
      let ax = 0, ay = 0, az = 0, weight = 0, separationX = 0, separationY = 0, separationZ = 0;
      const cx = Math.floor(state.x / CELL), cy = Math.floor(state.y / CELL), cz = Math.floor(state.z / CELL);
      let candidates = 0;
      outer: for (const dx of [0, -1, 1]) for (const dy of [0, -1, 1]) for (const dz of [0, -1, 1]) {
        const neighbours = grid.get(gridKey(cx + dx, cy + dy, cz + dz));
        if (!neighbours) continue;
        for (const other of neighbours) {
          if (other === state) continue;
          if (++candidates > 80) break outer;
          const x = other.x - state.x, y = other.y - state.y, z = other.z - state.z;
          const distance = Math.hypot(x, y, z);
          if (distance < .32) {
            // Birds ahead have more influence; turns travel through the flock.
            const ahead = x * state.vx + y * state.vy + z * state.vz > 0;
            const w = (ahead ? 1 : .30) * (1 - distance / .32);
            ax += other.vx * w; ay += other.vy * w; az += other.vz * w; weight += w;
          }
          if (distance > .0001 && distance < .105) {
            const strength = (.105 - distance) / .105 * .12 / distance;
            separationX -= x * strength; separationY -= y * strength; separationZ -= z * strength;
          }
        }
      }
      if (weight > 0) {
        desiredX = desiredX * .78 + ax / weight * .22;
        desiredY = desiredY * .78 + ay / weight * .22;
        desiredZ = desiredZ * .78 + az / weight * .22;
      }
      desiredX += separationX + windX; desiredY += separationY + windY; desiredZ += separationZ;
      const changeX = desiredX - state.vx, changeY = desiredY - state.vy, changeZ = desiredZ - state.vz;
      const change = Math.hypot(changeX, changeY, changeZ);
      const gain = Math.min(1 - Math.exp(-dt * 3.6), .75 * dt / Math.max(.0001, change));
      state.nextX = state.vx + changeX * gain; state.nextY = state.vy + changeY * gain; state.nextZ = state.vz + changeZ * gain;
    }
    // Commit together so snapshot ordering cannot determine who leads.
    for (const state of states) {
      state.vx = state.nextX; state.vy = state.nextY; state.vz = state.nextZ;
      state.x += state.vx * dt; state.y += state.vy * dt; state.z += state.vz * dt;
    }
  }

  return {
    sync(items, changes = []) {
      if (disposed) return;
      if (!Array.isArray(items) || !Array.isArray(changes)) throw new TypeError('Scene snapshots and changes must be arrays.');
      const ids = items.map(sceneBirdId);
      if (new Set(ids).size !== ids.length) throw new TypeError('A scene snapshot cannot contain duplicate itemIds.');
      const now = Date.now(), fresh = new Set();
      for (const [key, expiry] of seenEvents) if (expiry <= now) seenEvents.delete(key);
      for (const change of changes) {
        if (!change || !Number.isFinite(change.expiresAt) || change.expiresAt <= now) continue;
        const key = `${change.sourceId || ''}:${change.eventId || `${change.itemId}:${change.type}:${change.revision}`}`;
        if (seenEvents.has(key)) continue;
        seenEvents.set(key, change.expiresAt); fresh.add(change.itemId);
      }
      while (seenEvents.size > 4000) seenEvents.delete(seenEvents.keys().next().value);
      for (const lane of LANES) { frame.counts[lane].total = 0; frame.counts[lane].visible = 0; }
      for (const item of items) frame.counts[laneFor(item)].total++;
      const visible = items.slice(0, MAX_BIRDS), selected = new Set(visible.map(sceneBirdId));
      for (const id of flock.keys()) if (!selected.has(id)) flock.delete(id);
      states = visible.map(item => {
        const id = sceneBirdId(item);
        let state = flock.get(id);
        if (!state) {
          const v = variation(id), guide = route(flightTime / 1000 - v.delay), ahead = route(flightTime / 1000 - v.delay + .1);
          state = { variation: v, x: guide.x + v.ox, y: guide.y + v.oy, z: guide.z + v.oz,
            vx: (ahead.x - guide.x) * 10, vy: (ahead.y - guide.y) * 10, vz: (ahead.z - guide.z) * 10,
            activityUntil: 0, view: { birdId: id, heading: 0, bank: 0 } };
          if (initialized && fresh.has(id)) { state.x -= .22; state.y -= .12; }
          flock.set(id, state);
        }
        state.view.category = laneFor(item);
        state.view.readState = ['read', 'unread', 'unknown'].includes(item.readState) ? item.readState : 'unknown';
        if (initialized && fresh.has(id)) state.activityUntil = motionTime + 1800;
        frame.counts[state.view.category].visible++;
        return state;
      }).sort((a, b) => a.view.birdId.localeCompare(b.view.birdId));
      for (const lane of LANES) frame.counts[lane].overflow = frame.counts[lane].total - frame.counts[lane].visible;
      if (items.length) initialized = true;
      project();
    },
    update(dtMs, simTime = frame.time + dtMs) {
      if (disposed) return;
      if (!Number.isFinite(dtMs) || dtMs < 0 || !Number.isFinite(simTime)) throw new TypeError('Scene time must be finite milliseconds.');
      frame.time = simTime;
      if (!reducedMotion) {
        motionTime += dtMs;
        let remaining = dtMs * FLIGHT_RATE;
        while (remaining > .00001) {
          const elapsed = Math.min(STEP, remaining); flightTime += elapsed; step(elapsed / 1000); remaining -= elapsed;
        }
      }
      project(reducedMotion ? 0 : dtMs / 1000);
    },
    getFrame: () => frame,
    resize(viewport) {
      if (disposed) return;
      if (![viewport.width, viewport.height].every(validSize)) throw new TypeError('Scene dimensions must be positive numbers.');
      width = viewport.width; height = viewport.height; frame.width = width; frame.height = height; project();
    },
    setEnvironment(next = {}) {
      if (disposed) return;
      reducedMotion = next.reducedMotion ?? reducedMotion; environment = { ...environment, ...next }; project();
    },
    dispose() { disposed = true; flock.clear(); seenEvents.clear(); grid.clear(); states = []; frame.birds.length = 0; },
  };
}
