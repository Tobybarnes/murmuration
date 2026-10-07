import { createPerches, LANES, laneFor } from './perches.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const ease = value => 1 - (1 - value) ** 3;
const lerp = (a, b, t) => a + (b - a) * t;
export const hashId = id => [...String(id)].reduce((hash, char) => (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0, 7);

export function createWireScene({ width = 1200, height = 800, reducedMotion = false, now = Date.now } = {}) {
  const perches = createPerches({ width, height });
  const records = new Map();
  const desired = new Map();
  const seenChanges = new Map();
  const frame = { birds: [], geometry: LANES.map(lane => perches.wire(lane)), width, height, time: 0,
    counts: Object.fromEntries(LANES.map(lane => [lane, { total: 0, visible: 0, overflow: 0 }])) };
  let firstSync = true, disposed = false, weather = null;

  function settle(record) {
    const target = perches.point(record.birdId);
    if (!target) return;
    record.mode = 'perched'; record.x = target.x; record.y = target.y;
    record.vx = 0; record.vy = 0;
  }
  function approach(record, quiet = false) {
    const target = perches.point(record.birdId);
    if (!target) return;
    record.start = frame.time;
    record.duration = 2400 + record.seed % 900;
    record.from = { x: record.x, y: record.y };
    record.mode = 'approach'; record.released = false;
    if (quiet || reducedMotion) settle(record);
  }
  function admit(quiet = false) {
    for (const [id, item] of desired) {
      if (records.has(id)) continue;
      const reservation = perches.reserve(id, laneFor(item));
      if (!reservation) continue;
      const seed = hashId(id);
      const target = perches.point(id);
      const record = {
        birdId: id, item, seed, size: 13.5 + (seed % 30) / 10,
        x: seed % 2 ? -55 : frame.width + 55,
        y: target.y - 100 - seed % 70,
        wingPhase: seed % 628 / 100, activityUntil: -1,
        vx: 0, vy: 0, heading: seed % 2 ? 0 : Math.PI, view: {},
      };
      records.set(id, record);
      approach(record, quiet);
    }
  }
  function depart(record) {
    if (record.mode === 'takeoff') return;
    record.mode = 'takeoff'; record.start = frame.time;
    record.duration = 2000;
    // A perched position anchors the feet; flight positions anchor the body.
    // Start at body height so takeoff does not drop through the wire.
    record.from = { x: record.x, y: record.view.pose === 'perched' ? record.y - record.size * .7 : record.view.y };
    record.x = record.from.x; record.y = record.from.y;
    record.heading = Math.atan2(-130 - frame.height * .2, (record.seed % 2 ? 1 : -1) * (frame.width + 180));
    record.released = false;
    if (reducedMotion) { perches.release(record.birdId); records.delete(record.birdId); }
  }
  function sync(items, changes = []) {
    if (disposed) return;
    const next = new Map();
    for (const item of items) if (item?.itemId) next.set(item.itemId, { ...item });
    desired.clear();
    for (const entry of next) desired.set(...entry);
    for (const [id, record] of records) {
      const item = desired.get(id);
      if (!item) { depart(record); continue; }
      if (laneFor(item) !== laneFor(record.item)) {
        perches.release(id); records.delete(id); continue;
      }
      record.item = item;
      if (record.mode === 'takeoff') {
        if (perches.reserve(id, laneFor(item))) approach(record);
        else records.delete(id);
      }
    }
    admit(firstSync);
    const wallTime = now();
    for (const [key, expiresAt] of seenChanges) if (expiresAt <= wallTime) seenChanges.delete(key);
    for (const change of changes) {
      const key = change.eventId;
      if (!key || seenChanges.has(key) || !Number.isFinite(change.expiresAt) || change.expiresAt <= wallTime) continue;
      seenChanges.set(key, change.expiresAt);
      const record = records.get(change.itemId);
      if (record && (change.type === 'activity' || change.type === 'reply' || change.kind === 'activity')) record.activityUntil = frame.time + 1800;
    }
    firstSync = false;
    refresh();
  }
  function update(dtMs, simTime = frame.time + dtMs) {
    if (disposed || !Number.isFinite(dtMs) || dtMs < 0 || !Number.isFinite(simTime)) return;
    frame.time = simTime;
    const fresh = weather && Number.isFinite(weather.observedAt) && Number.isFinite(weather.expiresAt) && weather.observedAt <= now() && weather.expiresAt > now();
    const wind = fresh ? clamp(Number(weather.windKph) || 0, 0, 100) / 100 : 0;
    perches.setSway(reducedMotion ? 0 : Math.sin(frame.time * .0007 + (Number(weather?.windDirection) || 0) * Math.PI / 180) * wind * 3);
    for (const [id, record] of records) {
      const previousX = record.x, previousY = record.y;
      record.wingPhase += dtMs * (.014 + (record.seed % 9) * .0007);
      if (record.mode === 'perched') { settle(record); continue; }
      const progress = clamp((frame.time - record.start) / record.duration, 0, 1);
      if (record.mode === 'takeoff') {
        const direction = record.seed % 2 ? 1 : -1;
        record.x = record.from.x + direction * (frame.width + 180) * progress ** 1.4;
        record.y = record.from.y - (130 + frame.height * .2) * Math.sin(progress * Math.PI / 2);
        if (progress > .24 && !record.released) { perches.release(id); record.released = true; }
        if (progress >= 1) records.delete(id);
      } else {
        const target = perches.point(id);
        if (!target) { records.delete(id); continue; }
        const t = ease(progress);
        record.x = lerp(record.from.x, target.x, t);
        record.y = lerp(record.from.y, target.y, t) - Math.sin(progress * Math.PI) * 42;
        if (progress >= 1) settle(record);
      }
      if (record.mode !== 'perched' && dtMs > 0) {
        record.vx = (record.x - previousX) / dtMs;
        record.vy = (record.y - previousY) / dtMs;
        if (Math.abs(record.vx) + Math.abs(record.vy) > .00001) record.heading = Math.atan2(record.vy, record.vx);
      }
    }
    admit();
    refresh();
  }
  function refresh() {
    frame.birds.length = 0;
    for (const lane of LANES) Object.assign(frame.counts[lane], { total: 0, visible: 0, overflow: 0 });
    for (const item of desired.values()) frame.counts[laneFor(item)].total++;
    for (const record of records.values()) {
      const progress = clamp((frame.time - record.start) / record.duration, 0, 1);
      const active = !reducedMotion && record.activityUntil > frame.time;
      const perched = record.mode === 'perched';
      const facing = record.seed % 2 ? 1 : -1;
      const approaching = record.mode === 'approach';
      const landing = approaching && progress > .65;
      const poseProgress = perched ? 1 : landing ? (progress - .65) / .35 : record.mode === 'takeoff' ? progress : 0;
      Object.assign(record.view, {
        birdId: record.birdId, x: record.x, y: record.y - (landing ? record.size * .62 * poseProgress : 0),
        size: record.size, facing,
        heading: perched ? 0 : record.heading, vx: record.vx, vy: record.vy,
        wingPhase: record.wingPhase,
        bank: approaching ? Math.sin(progress * Math.PI) * .24 : 0,
        pose: perched ? 'perched' : record.mode === 'takeoff' ? 'takeoff' : landing ? 'landing' : 'flying',
        poseProgress,
        readState: record.item.readState || 'unknown',
        activity: active ? Math.sin((record.activityUntil - frame.time) * .004) ** 2 : 0,
        category: laneFor(record.item), departing: record.mode === 'takeoff',
      });
      frame.birds.push(record.view);
      if (!record.view.departing) frame.counts[record.view.category].visible++;
    }
    for (const counts of Object.values(frame.counts)) counts.overflow = counts.total - counts.visible;
  }
  function resize(viewport) {
    if (disposed) return;
    frame.width = Math.max(1, viewport.width); frame.height = Math.max(1, viewport.height);
    const displaced = perches.resize(viewport);
    for (const id of displaced) records.delete(id);
    admit(true);
    for (const record of records.values()) if (record.mode === 'perched') settle(record);
    refresh();
  }
  function setEnvironment(environment = {}) {
    if (disposed) return;
    reducedMotion = Boolean(environment.reducedMotion ?? reducedMotion);
    if ('weather' in environment) weather = environment.weather;
    if (reducedMotion) perches.setSway(0);
    if (reducedMotion) {
      for (const [id, record] of records) {
        if (record.mode === 'takeoff') { perches.release(id); records.delete(id); }
        else settle(record);
      }
      admit(true);
    }
    refresh();
  }
  refresh();
  return {
    sync, update, getFrame: () => frame, setEnvironment, resize,
    getReservations: () => perches.entries(),
    dispose() { disposed = true; records.clear(); desired.clear(); perches.clear(); frame.birds.length = 0; },
  };
}
