export const LANES = ['email', 'agents', 'other'];

export function laneFor(item) {
  if (item.category === 'email') return 'email';
  if (item.category === 'agents' || item.category === 'agent') return 'agents';
  return 'other';
}

// Slot numbers belong to items, never to their position in a provider snapshot.
export function createPerches({ width = 1200, height = 800 } = {}) {
  const reservations = new Map();
  const geometry = new Map(LANES.map(lane => [lane, { type: 'wire', lane }]));
  let layout;
  let sway = 0;
  function updateGeometry() {
    for (const [index, lane] of LANES.entries()) {
      const y = layout.top + layout.span * (index + .45) / 3 + sway;
      Object.assign(geometry.get(lane), { x1: -30, x2: layout.width + 30,
        y1: y - 13, y2: y + 4, sag: Math.min(52, layout.width * .045) });
    }
    for (const [id] of reservations) updatePoint(id);
  }
  function resize(viewport) {
    const w = Math.max(1, Number(viewport.width) || 1);
    const h = Math.max(1, Number(viewport.height) || 1);
    const compact = w < 640;
    const left = compact ? 72 : 180;
    const right = compact ? 35 : 90;
    const available = Math.max(0, w - left - right);
    const capacity = Math.max(1, Math.floor(available / 47));
    const top = compact ? 170 : 175;
    const bottom = compact ? 290 : 235;
    const span = Math.max(150, h - top - bottom);
    layout = { width: w, height: h, left, right, capacity, top, span };
    const displaced = [];
    for (const [id, reservation] of reservations) {
      if (reservation.slot >= capacity) {
        displaced.push(id);
        reservations.delete(id);
      }
    }
    updateGeometry();
    return displaced;
  }
  function reserve(id, lane) {
    if (!LANES.includes(lane)) throw new TypeError('Unknown wire category.');
    const existing = reservations.get(id);
    if (existing?.lane === lane) return { lane, slot: existing.slot };
    const used = new Set([...reservations.values()].filter(r => r.lane === lane).map(r => r.slot));
    // Spread the first few birds across the wire before filling the gaps.
    const order = Array.from({ length: layout.capacity }, (_, slot) => slot)
      .sort((a, b) => ((a * 7) % layout.capacity) - ((b * 7) % layout.capacity));
    const slot = order.find(candidate => !used.has(candidate));
    if (slot === undefined) return null;
    const reservation = { lane, slot, point: { x: 0, y: 0, lane, slot } };
    reservations.set(id, reservation);
    updatePoint(id);
    return { lane, slot };
  }
  function wire(lane) {
    return geometry.get(lane);
  }
  function updatePoint(id) {
    const reservation = reservations.get(id);
    if (!reservation) return null;
    const { left, right, width, capacity } = layout;
    const x = left + (width - left - right) * (reservation.slot + .5) / capacity;
    const geometry = wire(reservation.lane);
    const t = (x - geometry.x1) / (geometry.x2 - geometry.x1);
    const y = geometry.y1 + (geometry.y2 - geometry.y1) * t + 4 * geometry.sag * t * (1 - t);
    Object.assign(reservation.point, { x, y });
    return reservation.point;
  }
  resize({ width, height });
  return {
    resize, reserve, point: id => reservations.get(id)?.point ?? null, wire,
    setSway(value) { sway = value; updateGeometry(); },
    release: id => reservations.delete(id),
    has: id => reservations.has(id),
    get: id => reservations.has(id) ? { lane: reservations.get(id).lane, slot: reservations.get(id).slot } : null,
    entries: () => [...reservations].map(([id, value]) => [id, { lane: value.lane, slot: value.slot }]),
    get capacity() { return layout.capacity; },
    clear: () => reservations.clear(),
  };
}
