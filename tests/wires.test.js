import test from 'node:test';
import assert from 'node:assert/strict';
import { createPerches, LANES } from '../src/scenes/perches.js';
import { createWireScene } from '../src/scenes/wires.js';
import { createWireSky } from '../src/scenes/wire-sky.js';
import { createSampleStore, initialItems } from '../src/fixtures/wires.js';

const item = (id, category = 'email') => ({ itemId: id, category, readState: 'unread', revision: 1 });
const advance = (scene, duration, step = 1000 / 60) => {
  let left = duration;
  while (left > 0) { const dt = Math.min(left, step); scene.update(dt); left -= dt; }
};
const reservations = scene => new Map(scene.getReservations());
const noDoubleBooking = scene => {
  const occupied = scene.getReservations().map(([, value]) => `${value.lane}:${value.slot}`);
  assert.equal(new Set(occupied).size, occupied.length);
};
const bird = (scene, id) => scene.getFrame().birds.find(view => view.birdId === id);

test('perches reserve each lane independently and preserve surviving slots across resize', () => {
  const perches = createPerches({ width: 1200, height: 800 });
  for (const lane of LANES) {
    for (let index = 0; index < perches.capacity; index++) assert.ok(perches.reserve(`${lane}:${index}`, lane));
    assert.equal(perches.reserve(`${lane}:overflow`, lane), null);
  }
  const previous = new Map(perches.entries());
  const geometry = perches.wire('email');
  const displaced = perches.resize({ width: 390, height: 844 });
  assert.ok(displaced.length > 0);
  for (const [id, reservation] of perches.entries()) assert.deepEqual(reservation, previous.get(id));
  assert.equal(perches.wire('email'), geometry, 'wire geometry is reused');
  const beforeExpand = new Map(perches.entries());
  perches.resize({ width: 1400, height: 900 });
  for (const [id, reservation] of beforeExpand) assert.deepEqual(perches.get(id), reservation);
  assert.throws(() => perches.reserve('bad', 'unknown'), /category/);
});

test('arrival, snapshot reorder and removal do not shuffle settled birds', () => {
  const scene = createWireScene();
  const items = [item('one'), item('two'), item('three', 'agents')];
  scene.sync(items);
  const previous = reservations(scene);
  const positions = new Map(scene.getFrame().birds.map(view => [view.birdId, [view.x, view.y]]));
  const frame = scene.getFrame(), views = frame.birds, counts = frame.counts, first = bird(scene, 'one');
  scene.sync([...items].reverse());
  scene.sync([...items, item('arrival')]);
  advance(scene, 3600);
  for (const current of items) {
    assert.deepEqual(reservations(scene).get(current.itemId), previous.get(current.itemId));
    assert.deepEqual([bird(scene, current.itemId).x, bird(scene, current.itemId).y], positions.get(current.itemId));
  }
  scene.sync([items[0], items[2], item('arrival')]); advance(scene, 2200);
  assert.deepEqual(reservations(scene).get('one'), previous.get('one'));
  assert.equal(frame, scene.getFrame()); assert.equal(views, frame.birds); assert.equal(counts, frame.counts); assert.equal(first, bird(scene, 'one'));
  noDoubleBooking(scene);
});

test('an incoming bird brakes, extends its feet and settles on the wire', () => {
  const scene = createWireScene(); scene.sync([]); scene.sync([item('arrival')]);
  const start = { ...bird(scene, 'arrival') };
  advance(scene, 500); const firstMove = Math.abs(bird(scene, 'arrival').x - start.x);
  advance(scene, 1500); const later = { ...bird(scene, 'arrival') };
  advance(scene, 500); const lastMove = Math.abs(bird(scene, 'arrival').x - later.x);
  assert.ok(firstMove > lastMove * 2, 'approach should brake near the perch');
  assert.equal(bird(scene, 'arrival').pose, 'landing');
  advance(scene, 1200);
  const view = bird(scene, 'arrival'); assert.equal(view.pose, 'perched');
  const wire = scene.getFrame().geometry.find(geometry => geometry.lane === 'email');
  const t = (view.x - wire.x1) / (wire.x2 - wire.x1);
  const wireY = wire.y1 + (wire.y2 - wire.y1) * t + 4 * wire.sag * t * (1 - t);
  assert.equal(view.y, wireY, 'feet must contact the visible wire curve');
});

test('departure during landing keeps a reservation until clear and faces its movement', () => {
  const scene = createWireScene(); scene.sync([]); scene.sync([item('incoming')]); advance(scene, 2400);
  scene.sync([]); const before = { ...bird(scene, 'incoming') };
  assert.equal(before.pose, 'takeoff'); assert.ok(reservations(scene).has('incoming'));
  advance(scene, 100); const after = bird(scene, 'incoming');
  assert.ok((after.x - before.x) * Math.cos(after.heading) + (after.y - before.y) * Math.sin(after.heading) > 0, 'head points along departure');
  advance(scene, 450); assert.equal(reservations(scene).has('incoming'), false);
  advance(scene, 1600); assert.equal(bird(scene, 'incoming'), undefined);
});

test('overflow refills vacated perches and a returning departure cannot double-book', () => {
  const scene = createWireScene({ width: 390, height: 844 });
  const items = Array.from({ length: 14 }, (_, index) => item(`email:${index}`));
  scene.sync(items); const before = scene.getFrame().counts.email;
  assert.equal(before.visible, 6); assert.equal(before.total, 14); assert.equal(before.overflow, 8);
  const removedId = scene.getFrame().birds[0].birdId;
  scene.sync(items.filter(current => current.itemId !== removedId)); advance(scene, 550);
  assert.equal(scene.getFrame().counts.email.visible, 6);
  scene.sync(items); noDoubleBooking(scene);
  advance(scene, 4000); noDoubleBooking(scene);
  scene.resize({ width: 320, height: 760 }); noDoubleBooking(scene);
  assert.equal(scene.getFrame().counts.email.visible, 4);
  assert.equal(scene.getFrame().counts.email.total, 14);
  scene.resize({ width: 1300, height: 800 }); noDoubleBooking(scene);
  assert.equal(scene.getFrame().counts.email.visible, 14);
});

test('reduced motion applies changes at rest and fresh weather sways feet with their wire', () => {
  let now = 10_000;
  const scene = createWireScene({ reducedMotion: true, now: () => now });
  scene.sync([]); scene.sync([item('email')]); assert.equal(bird(scene, 'email').pose, 'perched');
  scene.sync([]); assert.equal(scene.getFrame().birds.length, 0);
  scene.sync([item('email')]); const resting = bird(scene, 'email').y;
  scene.setEnvironment({ reducedMotion: false, weather: { windKph: 90, windDirection: 90, observedAt: now - 100, expiresAt: now + 10_000 } });
  scene.update(0); assert.ok(bird(scene, 'email').y > resting + 2);
  now += 20_000; scene.update(0); assert.equal(bird(scene, 'email').y, resting);
  scene.setEnvironment({ reducedMotion: true }); advance(scene, 600); assert.equal(bird(scene, 'email').y, resting);
});

test('wire and sky scenes preserve canonical IDs and item state across repeated switches', () => {
  const wires = createWireScene(), sky = createWireSky();
  sky.setEnvironment({ reducedMotion: true }); // initialization before the first snapshot is safe
  const items = initialItems();
  for (const scene of [wires, sky]) scene.sync(items);
  const expected = items.map(current => current.itemId).sort();
  const views = sky.getFrame().birds, first = views[0];
  for (let index = 0; index < 8; index++) {
    const active = index % 2 ? wires : sky; active.update(1000 / 60);
    assert.deepEqual(active.getFrame().birds.map(view => view.birdId).sort(), expected);
  }
  assert.equal(sky.getFrame().birds, views); assert.equal(views[0], first);
  assert.deepEqual(items, initialItems(), 'scenes cannot edit provider data');
  wires.dispose(); sky.dispose();
  for (const scene of [wires, sky]) { scene.sync(items); scene.update(1000); scene.resize({ width: 500, height: 800 }); assert.equal(scene.getFrame().birds.length, 0); }
});

test('fixture deliveries are idempotent and stale upserts cannot resurrect an archive', () => {
  const store = createSampleStore([]);
  const upsert = { eventId: 'one', itemId: 'email', type: 'upsert', revision: 1, item: item('email'), occurredAt: 100 };
  assert.equal(store.apply(upsert).length, 1); assert.equal(store.apply(upsert).length, 0);
  store.apply({ eventId: 'two', itemId: 'email', type: 'remove', revision: 3, occurredAt: 300 });
  assert.equal(store.apply({ ...upsert, eventId: 'delayed', revision: 2 }).length, 0);
  assert.equal(store.items().length, 0);
});

test('expired or repeated activity deliveries cannot restart a settled bird response', () => {
  const now = 10_000, scene = createWireScene({ now: () => now });
  const items = [item('agent', 'agents')];
  scene.sync(items);
  const change = { eventId: 'reply:1', itemId: 'agent', type: 'activity', expiresAt: now + 10_000 };
  scene.sync(items, [change]); advance(scene, 500);
  const activity = bird(scene, 'agent').activity;
  scene.sync(items, [change]); assert.equal(bird(scene, 'agent').activity, activity);
  advance(scene, 2000); assert.equal(bird(scene, 'agent').activity, 0);
  scene.sync(items, [{ ...change, eventId: 'stale:1', expiresAt: now - 1 }]);
  assert.equal(bird(scene, 'agent').activity, 0);
});
