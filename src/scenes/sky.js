// Original 3D flock steering and spatial hash by Ben Bashford.
// https://benbashford.com/experiments/murmuration/murmuration.html
// See ../../ATTRIBUTION.md. The numerical steering below is preserved.
import { PARAMS, resolveParameters } from '../parameters.js';
import { createSceneFrame, sceneBirdId, birdVariation } from '../scene-contract.js';

const STEP_MS = 1000 / 60;
const TAU = Math.PI * 2;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

export function createSkyScene({ width = 1200, height = 800, values = PARAMS.map(p => p.def) } = {}) {
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) throw new TypeError('Scene dimensions must be positive numbers.');
  let W = width, H = height, P = resolveParameters(values);
  let disposed = false, externalItems = false, simTime = 0;
  let environment = { weather: null, listening: null };
  const frame = createSceneFrame(width, height);
  const birdCache = new Map();
  const itemMetadata = new Map();
  const seenEvents = new Map();
  const MAX = 2400;
  const px = new Float32Array(MAX), py = new Float32Array(MAX), pz = new Float32Array(MAX);
  const vx = new Float32Array(MAX), vy = new Float32Array(MAX), vz = new Float32Array(MAX);
  const sx = new Float32Array(MAX), sy = new Float32Array(MAX), sr = new Float32Array(MAX);
  const linked = new Uint8Array(MAX);
  // Adaptation: these are explicitly simulated IDs. The original's invented
  // country codes are omitted so nodes cannot be mistaken for real messages.
  const ids = [];

  let N = 0;
  function bounds() { return { bx: W * 0.38, by: H * 0.34, bz: Math.min(W, H) * 0.3 }; }
  function spawn(i, near) {
    const b = bounds();
    if (near !== undefined && N > 0) {
      const j = (Math.random() * N) | 0;
      px[i] = px[j] + (Math.random() - .5) * 20; py[i] = py[j] + (Math.random() - .5) * 20; pz[i] = pz[j] + (Math.random() - .5) * 20;
      vx[i] = vx[j]; vy[i] = vy[j]; vz[i] = vz[j];
    } else {
      px[i] = (Math.random() - .5) * b.bx * 1.6; py[i] = (Math.random() - .5) * b.by * 1.6; pz[i] = (Math.random() - .5) * b.bz * 1.6;
      const a = Math.random() * Math.PI * 2;
      vx[i] = Math.cos(a) * 2; vy[i] = Math.sin(a) * 2; vz[i] = (Math.random() - .5);
    }
    ids[i] = ids[i] || `sim-${String(i + 1).padStart(4, '0')}`;
  }
  function setCount(n) {
    n = Math.max(1, Math.min(MAX, Math.round(n)));
    while (N < n) { spawn(N, true); N++; }
    N = n;
  }
  function scatterFlock() { for (let i = 0; i < N; i++) spawn(i); }
  // Opening state: one loose cloud all heading roughly the same way.
  function gather() {
    const a = Math.random() * Math.PI * 2;
    for (let i = 0; i < N; i++) {
      spawn(i);
      const g = () => (Math.random() + Math.random() + Math.random() - 1.5) * 160;
      px[i] = g() * 1.6; py[i] = g(); pz[i] = g();
      vx[i] = Math.cos(a) * 2 + (Math.random() - .5); vy[i] = Math.sin(a) * 2 + (Math.random() - .5); vz[i] = Math.random() - .5;
    }
  }

  // Spatial hash (counting sort into a fixed table; collisions only add
  // candidates that the distance test then throws away).
  const TS = 8192, MASK = TS - 1;
  const cellCount = new Int32Array(TS + 1), cellStart = new Int32Array(TS + 1);
  const cellOf = new Int32Array(MAX), sorted = new Int32Array(MAX);
  const hash = (ix, iy, iz) => ((ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791)) & MASK;
  let cell = 50;
  function buildGrid() {
    cellCount.fill(0);
    for (let i = 0; i < N; i++) {
      const k = hash(Math.floor(px[i] / cell), Math.floor(py[i] / cell), Math.floor(pz[i] / cell));
      cellOf[i] = k; cellCount[k]++;
    }
    let acc = 0;
    for (let k = 0; k < TS; k++) { cellStart[k] = acc; acc += cellCount[k]; }
    cellStart[TS] = acc;
    const fillPos = cellCount; // reuse as cursor
    for (let k = 0; k < TS; k++) fillPos[k] = cellStart[k];
    for (let i = 0; i < N; i++) sorted[fillPos[cellOf[i]]++] = i;
  }

  // Links collected during the neighbour pass, drawn afterwards.
  const MAX_LINKS = MAX * 3;
  const la = new Int32Array(MAX_LINKS), lb = new Int32Array(MAX_LINKS), ld = new Float32Array(MAX_LINKS);
  let L = 0;

  // Predator + attractor
  const pred = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, on: false };
  const mouse = { x: 0, y: 0, down: false };

  const NEIGHBOUR_CAP = 14;   // starlings track roughly 7; a bit more reads smoother on screen
  const CANDIDATE_CAP = 160;   // keeps dense clumps from going quadratic
  const LINKS_PER_NODE = 3;
  const FOCAL = 1600;

  const seenKeys = new Int32Array(27);
  const OFF = [0, -1, 1];
  function step(dt, t) {
    const b = bounds();
    const R = P.vision, R2 = R * R;
    const S = P.space, S2 = S * S;
    const LD = P.link, LD2 = LD * LD;
    cell = Math.max(R, LD, 12);
    buildGrid();
    L = 0;
    linked.fill(0, 0, N);

    const activeWeather = environment.weather?.expiresAt > Date.now() ? environment.weather : null;
    const activeListening = environment.listening?.expiresAt > Date.now() ? environment.listening : null;
    const wind = (activeWeather?.windKph || 0) / 100 * 0.035;
    const windAngle = (activeWeather?.windDirection || 0) * Math.PI / 180;
    const maxV = P.speed * (activeListening?.playing ? 1.06 : 1), minV = maxV * 0.55;
    const wSep = P.sep * 0.6, wAli = P.align, wCoh = P.coh;
    const turb = P.turb * 0.25, att = P.attract * 0.12;

    // Attractor: a slow Lissajous wander, or the pointer while held.
    let ax, ay, az;
    if (mouse.down) { ax = mouse.x - W / 2; ay = mouse.y - H / 2; az = 0; }
    else {
      ax = Math.sin(t * 0.00011) * b.bx * 0.7;
      ay = Math.sin(t * 0.00017 + 1.3) * b.by * 0.6;
      az = Math.sin(t * 0.00013 + 0.4) * b.bz * 0.7;
    }

    // Predator chases the flock's centre of mass with a lag.
    pred.on = N > 0 && P.pred > 0.02;
    const fleeR = 60 + P.pred * 220, fleeR2 = fleeR * fleeR;
    if (pred.on) {
      let cx = 0, cy = 0, cz = 0;
      const stride = Math.max(1, (N / 200) | 0);
      let c = 0;
      for (let i = 0; i < N; i += stride) { cx += px[i]; cy += py[i]; cz += pz[i]; c++; }
      cx /= c; cy /= c; cz /= c;
      const dx = cx - pred.x, dy = cy - pred.y, dz = cz - pred.z;
      const d = Math.hypot(dx, dy, dz) || 1;
      const pv = maxV * (1.1 + P.pred * 0.6);
      pred.vx += (dx / d * pv - pred.vx) * 0.04 * dt + Math.sin(t * 0.003) * 0.3;
      pred.vy += (dy / d * pv - pred.vy) * 0.04 * dt + Math.cos(t * 0.0023) * 0.3;
      pred.vz += (dz / d * pv - pred.vz) * 0.04 * dt;
      pred.x += pred.vx * dt; pred.y += pred.vy * dt; pred.z += pred.vz * dt;
    } else {
      pred.x = -b.bx * 1.4; pred.y = -b.by * 1.4; pred.z = 0; pred.vx = pred.vy = pred.vz = 0;
    }

    for (let i = 0; i < N; i++) {
      const x = px[i], y = py[i], z = pz[i];
      const ix = Math.floor(x / cell), iy = Math.floor(y / cell), iz = Math.floor(z / cell);
      let sepX = 0, sepY = 0, sepZ = 0;
      let aliX = 0, aliY = 0, aliZ = 0;
      let cohX = 0, cohY = 0, cohZ = 0;
      let n = 0, cand = 0, links = 0, nk = 0;

      outer:
      for (let a = 0; a < 3; a++) for (let bb = 0; bb < 3; bb++) for (let cc = 0; cc < 3; cc++) {
        // Own cell first, so the candidate cap never skips the closest neighbours.
        const k = hash(ix + OFF[a], iy + OFF[bb], iz + OFF[cc]);
        let dup = false;
        for (let q = 0; q < nk; q++) if (seenKeys[q] === k) { dup = true; break; }
        if (dup) continue;
        seenKeys[nk++] = k;
        for (let s = cellStart[k], e = cellStart[k + 1]; s < e; s++) {
          const j = sorted[s];
          if (j === i) continue;
          if (++cand > CANDIDATE_CAP) break outer;
          const ox = px[j] - x, oy = py[j] - y, oz = pz[j] - z;
          const d2 = ox * ox + oy * oy + oz * oz;
          if (d2 < R2 && n < NEIGHBOUR_CAP) {
            n++;
            aliX += vx[j]; aliY += vy[j]; aliZ += vz[j];
            cohX += ox; cohY += oy; cohZ += oz;
            if (d2 < S2 && d2 > 0.0001) {
              const d = Math.sqrt(d2), f = (1 - d / S) / d;
              sepX -= ox * f; sepY -= oy * f; sepZ -= oz * f;
            }
          }
          if (j > i && d2 < LD2 && links < LINKS_PER_NODE && L < MAX_LINKS) {
            la[L] = i; lb[L] = j; ld[L] = Math.sqrt(d2) / LD; L++; links++;
            linked[i] = 1; linked[j] = 1;
          }
        }
      }

      let fx = 0, fy = 0, fz = 0;
      if (wind > 0) { fx = Math.sin(windAngle) * wind; fy = -Math.cos(windAngle) * wind; }
      if (n > 0) {
        fx += (aliX / n - vx[i]) * wAli; fy += (aliY / n - vy[i]) * wAli; fz += (aliZ / n - vz[i]) * wAli;
        fx += cohX / n * wCoh;            fy += cohY / n * wCoh;            fz += cohZ / n * wCoh;
      }
      fx += sepX * wSep; fy += sepY * wSep; fz += sepZ * wSep;

      // Turbulence: a cheap swirling field so the flock keeps breaking up and re-forming.
      if (turb > 0) {
        const tt = t * 0.0004;
        fx += (Math.sin(y * 0.006 + tt) + Math.sin(z * 0.009 - tt * 1.3)) * turb;
        fy += (Math.sin(z * 0.007 + tt * 0.8) + Math.sin(x * 0.005 + tt * 1.1)) * turb;
        fz += (Math.sin(x * 0.008 - tt * 0.6) + Math.sin(y * 0.01 + tt * 0.9)) * turb * 0.6;
      }

      // Attractor
      if (att > 0) {
        const ox = ax - x, oy = ay - y, oz = az - z;
        // Pull grows with distance, so stray groups get reeled back into the main flock.
        const d = Math.hypot(ox, oy, oz) + 1, m = att * Math.min(2.5, d / 220) / d;
        fx += ox * m; fy += oy * m; fz += oz * m;
      }

      // Soft walls, so nothing ever leaves the screen for long.
      const turn = 0.12;
      if (x < -b.bx) fx += turn * Math.min(3, (-b.bx - x) / 40 + 1); else if (x > b.bx) fx -= turn * Math.min(3, (x - b.bx) / 40 + 1);
      if (y < -b.by) fy += turn * Math.min(3, (-b.by - y) / 40 + 1); else if (y > b.by) fy -= turn * Math.min(3, (y - b.by) / 40 + 1);
      if (z < -b.bz) fz += turn * Math.min(3, (-b.bz - z) / 40 + 1); else if (z > b.bz) fz -= turn * Math.min(3, (z - b.bz) / 40 + 1);

      // Predator
      if (pred.on) {
        const ox = x - pred.x, oy = y - pred.y, oz = z - pred.z;
        const d2 = ox * ox + oy * oy + oz * oz;
        if (d2 < fleeR2) {
          const d = Math.sqrt(d2) || 1, f = (1 - d / fleeR) * 1.4 / d;
          fx += ox * f; fy += oy * f; fz += oz * f;
        }
      }

      let nvx = vx[i] + fx * dt, nvy = vy[i] + fy * dt, nvz = vz[i] + fz * dt;
      const sp = Math.hypot(nvx, nvy, nvz) || 1;
      const k = sp > maxV ? maxV / sp : sp < minV ? minV / sp : 1;
      vx[i] = nvx * k; vy[i] = nvy * k; vz[i] = nvz * k;
    }

    for (let i = 0; i < N; i++) { px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt; }
  }

  function refreshLinks() {
    const distance = P.link, distance2 = distance * distance;
    cell = Math.max(P.vision, distance, 12);
    buildGrid();
    L = 0;
    linked.fill(0, 0, N);
    if (distance <= 0) return;
    for (let i = 0; i < N; i++) {
      const ix = Math.floor(px[i] / cell), iy = Math.floor(py[i] / cell), iz = Math.floor(pz[i] / cell);
      let candidates = 0, links = 0, keyCount = 0;
      outer:
      for (const ox of OFF) for (const oy of OFF) for (const oz of OFF) {
        const key = hash(ix + ox, iy + oy, iz + oz);
        let duplicate = false;
        for (let q = 0; q < keyCount; q++) if (seenKeys[q] === key) { duplicate = true; break; }
        if (duplicate) continue;
        seenKeys[keyCount++] = key;
        for (let s = cellStart[key]; s < cellStart[key + 1]; s++) {
          const j = sorted[s];
          if (j === i) continue;
          if (++candidates > CANDIDATE_CAP) break outer;
          const dx = px[j] - px[i], dy = py[j] - py[i], dz = pz[j] - pz[i];
          const d2 = dx * dx + dy * dy + dz * dz;
          if (j > i && d2 < distance2 && links < LINKS_PER_NODE && L < MAX_LINKS) {
            la[L] = i; lb[L] = j; ld[L] = Math.sqrt(d2) / distance;
            L++; links++;
            linked[i] = 1; linked[j] = 1;
          }
        }
      }
    }
  }


  const linksGeometry = { type: 'links', a: la, b: lb, distances: ld, count: 0 };
  const predatorGeometry = { type: 'predator', on: false, x: 0, y: 0, radius: 0, fleeRadius: 0 };
  frame.geometry.push(linksGeometry, predatorGeometry);
  frame.parameters = P;
  frame.environment = environment;
  frame.total = 0;

  function project(dtMs = 0) {
    frame.width = W; frame.height = H; frame.time = simTime;
    frame.parameters = P; frame.environment = environment;
    frame.birds.length = N;
    if (!externalItems) frame.total = N;
    for (let i = 0; i < N; i++) {
      const id = ids[i];
      let bird = birdCache.get(id);
      if (!bird) {
        bird = { birdId: id, heading: Math.atan2(vy[i], vx[i]), bank: 0, activityUntil: 0, variation: birdVariation(id) };
        birdCache.set(id, bird);
      }
      const perspective = FOCAL / Math.max(80, FOCAL + pz[i]);
      sx[i] = W / 2 + px[i] * perspective;
      sy[i] = H / 2 + py[i] * perspective;
      sr[i] = Math.max(0.5, P.size / 2 * perspective);
      const heading = Math.hypot(vx[i], vy[i]) > 0.0001 ? Math.atan2(vy[i], vx[i]) : bird.heading;
      if (dtMs > 0) {
        const turn = Math.atan2(Math.sin(heading - bird.heading), Math.cos(heading - bird.heading));
        bird.bank += (clamp(turn * 9, -0.85, 0.85) - bird.bank) * Math.min(1, dtMs / 120);
        bird.heading = heading;
      }
      const seconds = simTime / 1000;
      bird.x = sx[i]; bird.y = sy[i]; bird.z = pz[i];
      bird.radius = sr[i]; bird.size = P.size * 0.64 * perspective * bird.variation.scale;
      bird.vx = vx[i]; bird.vy = vy[i]; bird.vz = vz[i];
      bird.wingPhase = seconds * TAU * bird.variation.frequency + bird.variation.phase;
      bird.pose = Math.sin(seconds * 0.63 + bird.variation.glideOffset) > 0.84 ? 'gliding' : 'flying';
      bird.linked = linked[i];
      bird.readState = itemMetadata.get(id)?.readState || 'unknown';
      bird.activity = clamp((bird.activityUntil - simTime) / 2400, 0, 1);
      bird.alpha = clamp(0.84 + (perspective - 1) * 0.6, 0.5, 1);
      frame.birds[i] = bird;
    }
    linksGeometry.count = L;
    predatorGeometry.on = pred.on;
    if (pred.on) {
      const perspective = FOCAL / Math.max(80, FOCAL + pred.z);
      predatorGeometry.x = W / 2 + pred.x * perspective;
      predatorGeometry.y = H / 2 + pred.y * perspective;
      predatorGeometry.radius = Math.max(4, P.size * 0.9) * perspective;
      predatorGeometry.fleeRadius = (60 + P.pred * 220) * perspective;
    }
  }

  function update(dtMs, time = simTime + dtMs) {
    if (disposed) return;
    if (!Number.isFinite(dtMs) || dtMs < 0 || !Number.isFinite(time)) throw new TypeError('Scene time must be finite milliseconds.');
    simTime = time;
    if (N > 0 && dtMs > 0) step(dtMs / STEP_MS, simTime);
    else if (N === 0) { L = 0; pred.on = false; }
    project(dtMs);
  }

  function setParameters(values) {
    const resolved = resolveParameters(values);
    if (disposed) return;
    P = resolved;
    if (!externalItems) setCount(P.count);
    refreshLinks();
    project();
  }

  function sync(items, changes = []) {
    if (disposed) return;
    if (!Array.isArray(items) || !Array.isArray(changes)) throw new TypeError('Scene snapshots and changes must be arrays.');
    const incomingIds = items.map(sceneBirdId);
    if (new Set(incomingIds).size !== incomingIds.length) throw new TypeError('A scene snapshot cannot contain duplicate itemIds.');
    // Repacking happens only when external state changes, never while drawing.
    const old = new Map();
    for (let i = 0; i < N; i++) old.set(ids[i], [px[i], py[i], pz[i], vx[i], vy[i], vz[i]]);
    const now = Date.now();
    for (const [eventId, expiresAt] of seenEvents) if (expiresAt <= now) seenEvents.delete(eventId);
    const freshChanges = changes.filter(change => {
      if (!change || !Number.isFinite(change.expiresAt) || change.expiresAt <= now) return false;
      const eventId = change.eventId || `${change.itemId}:${change.type}:${change.revision}`;
      if (seenEvents.has(eventId)) return false;
      seenEvents.set(eventId, change.expiresAt);
      return true;
    });
    const arrivals = new Set(freshChanges.filter(change => change.type === 'upsert').map(change => change.itemId));
    const selected = new Set(incomingIds.slice(0, MAX));
    externalItems = true;
    frame.total = items.length;
    N = Math.min(MAX, items.length);
    for (let i = 0; i < N; i++) {
      const id = incomingIds[i], saved = old.get(id);
      if (saved) [px[i], py[i], pz[i], vx[i], vy[i], vz[i]] = saved;
      else {
        spawn(i);
        if (arrivals.has(id)) px[i] = (birdVariation(id).phase < Math.PI ? -1 : 1) * W * 0.55;
      }
      ids[i] = id;
      itemMetadata.set(id, { readState: ['read', 'unread', 'unknown'].includes(items[i].readState) ? items[i].readState : 'unknown' });
    }
    for (const id of birdCache.keys()) if (!selected.has(id)) birdCache.delete(id);
    for (const id of itemMetadata.keys()) if (!selected.has(id)) itemMetadata.delete(id);
    refreshLinks();
    project();
    for (const change of freshChanges) {
      const bird = birdCache.get(change.itemId);
      if (bird && change.type !== 'remove' && change.expiresAt > now) {
        bird.activityUntil = simTime + Math.min(2400, change.expiresAt - now);
      }
    }
    project();
  }

  function setEnvironment(next = {}) {
    if (disposed) return;
    const now = Date.now();
    const weather = next.weather;
    const listening = next.listening;
    environment = {
      weather: weather && Number.isFinite(weather.expiresAt) && weather.expiresAt > now ? {
        observedAt: weather.observedAt, expiresAt: weather.expiresAt,
        cloudCover: clamp(Number.isFinite(weather.cloudCover) ? weather.cloudCover : 0.25, 0, 1),
        windKph: clamp(Number.isFinite(weather.windKph) ? weather.windKph : 0, 0, 100),
        windDirection: Number.isFinite(weather.windDirection) ? weather.windDirection : 0,
        isDay: weather.isDay !== false,
      } : null,
      listening: listening && Number.isFinite(listening.expiresAt) && listening.expiresAt > now ? {
        observedAt: listening.observedAt, expiresAt: listening.expiresAt, playing: listening.playing === true,
      } : null,
    };
    frame.environment = environment;
  }

  function resize({ width, height }) {
    if (disposed) return;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new TypeError('Scene dimensions must be positive numbers.');
    W = width; H = height;
    project();
  }

  function reset() {
    if (disposed) return;
    P = resolveParameters();
    if (!externalItems) setCount(P.count);
    gather();
    Object.assign(pred, { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, on: false });
    simTime = 0;
    refreshLinks();
    project();
  }

  function scatter() {
    if (disposed) return;
    scatterFlock(); refreshLinks(); project();
  }

  function setPointer(x, y, down) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError('Pointer coordinates must be finite numbers.');
    if (disposed) return;
    mouse.x = x; mouse.y = y; mouse.down = Boolean(down);
  }

  function getState() {
    const positions = Array.from({ length: N }, (_, i) => [px[i], py[i], pz[i]]);
    const velocities = Array.from({ length: N }, (_, i) => [vx[i], vy[i], vz[i]]);
    return {
      count: N, simTime, positions, velocities, links: L, parameters: { ...P }, width: W, height: H,
      finite: positions.every(point => point.every(Number.isFinite)) && velocities.every(vector => vector.every(Number.isFinite)),
      itemIds: ids.slice(0, N),
    };
  }

  function dispose() {
    disposed = true;
    birdCache.clear(); itemMetadata.clear(); seenEvents.clear();
    frame.birds.length = 0; frame.geometry.length = 0;
    mouse.down = false;
  }

  setCount(P.count);
  gather();
  refreshLinks();
  project();
  return { sync, update, getFrame: () => frame, setEnvironment, resize, dispose, setParameters, reset, scatter, setPointer, getState };
}
