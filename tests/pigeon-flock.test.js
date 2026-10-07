import test from 'node:test';
import assert from 'node:assert/strict';
import { createWireSky } from '../src/scenes/wire-sky.js';
import { initialItems } from '../src/fixtures/wires.js';
const STEP = 1000 / 60;
const advance = (scene, frames) => { for (let i = 0; i < frames; i++) scene.update(STEP); };
const positions = scene => new Map(scene.getFrame().birds.map(bird => [bird.birdId, { ...bird }]));

// These are visible-behaviour bounds: a flock stays together, moves across the
// sky, has no teleports, and fits between the title and controls on each device.
test('pigeons circle as a coherent flock and stay in the usable sky on desktop and phone', () => {
  for (const [width, height] of [[1200, 800], [390, 844], [844, 660]]) {
    const scene = createWireSky({ width, height }); scene.sync(initialItems());
    let previous = positions(scene), left = Infinity, right = -Infinity;
    for (let tick = 0; tick < 2400; tick++) {
      scene.update(STEP);
      const birds = scene.getFrame().birds;
      const cx = birds.reduce((sum, bird) => sum + bird.x, 0) / birds.length;
      const cy = birds.reduce((sum, bird) => sum + bird.y, 0) / birds.length;
      left = Math.min(left, cx); right = Math.max(right, cx);
      const alignment = Math.hypot(birds.reduce((sum, bird) => sum + Math.cos(bird.heading), 0),
        birds.reduce((sum, bird) => sum + Math.sin(bird.heading), 0)) / birds.length;
      assert.ok(alignment > .75, 'birds follow a common heading instead of swirling independently');
      for (const bird of birds) {
        assert.ok([bird.x, bird.y, bird.heading, bird.size, bird.wingPhase, bird.bank].every(Number.isFinite));
        assert.ok(bird.x > bird.size * 2 && bird.x < width - bird.size * 2);
        assert.ok(bird.y > 205 && bird.y < height - (width < 640 ? 310 : 235));
        assert.ok(Math.hypot(bird.x - cx, bird.y - cy) < width * .2, 'flock stays compact');
        const before = previous.get(bird.birdId);
        assert.ok(Math.hypot(bird.x - before.x, bird.y - before.y) < 4, 'flight remains continuous');
      }
      previous = positions(scene);
    }
    assert.ok(right - left > width * .4, 'flock makes a circuit across the scene');
    scene.dispose();
  }
});

test('reordered snapshots preserve each pigeon and subsequent flight, while reads and counts update', () => {
  const scene = createWireSky(), control = createWireSky(), items = initialItems();
  scene.sync(items); control.sync(items); advance(scene, 80); advance(control, 80);
  const frame = scene.getFrame(), birds = frame.birds, views = new Map(birds.map(bird => [bird.birdId, bird]));
  scene.sync([...items].reverse()); advance(scene, 80); advance(control, 80);
  assert.deepEqual(positions(scene), positions(control));
  const firstId = items[0].itemId;
  scene.sync(items.map(item => item.itemId === firstId ? { ...item, readState: 'read' } : item));
  assert.equal(scene.getFrame(), frame); assert.equal(frame.birds, birds);
  assert.equal(views.get(firstId), frame.birds.find(bird => bird.birdId === firstId));
  assert.equal(views.get(firstId).readState, 'read');
  scene.sync([items[0]]); assert.equal(frame.birds.length, 1); assert.equal(frame.birds[0].birdId, firstId);
  scene.sync([]); advance(scene, 60); assert.equal(frame.birds.length, 0);
  assert.equal(Object.values(frame.counts).reduce((sum, count) => sum + count.total, 0), 0);
});

test('reduced motion freezes positions and wingbeats, and resizing keeps item identities', () => {
  const scene = createWireSky(); scene.sync(initialItems()); advance(scene, 300);
  scene.setEnvironment({ reducedMotion: true }); const still = positions(scene);
  advance(scene, 100); assert.deepEqual(positions(scene), still);
  scene.update(0, 80_000); assert.deepEqual(positions(scene), still);
  scene.resize({ width: 390, height: 844 });
  assert.deepEqual([...positions(scene).keys()].sort(), [...still.keys()].sort());
  for (const bird of scene.getFrame().birds) assert.equal(bird.wingPhase, still.get(bird.birdId).wingPhase);
  scene.setEnvironment({ reducedMotion: false }); advance(scene, 1);
  assert.notEqual(scene.getFrame().birds[0].wingPhase, still.get(scene.getFrame().birds[0].birdId).wingPhase);
  scene.dispose(); scene.update(100); scene.sync(initialItems()); assert.equal(scene.getFrame().birds.length, 0);
});

test('invalid or stale weather cannot poison flight and replayed activity cannot restart a response', () => {
  const scene = createWireSky(), items = initialItems(); scene.sync(items);
  scene.setEnvironment({ weather: { windKph: 'bad', windDirection: Infinity, expiresAt: Date.now() + 30_000 } });
  advance(scene, 20);
  for (const bird of scene.getFrame().birds) assert.ok([bird.x, bird.y, bird.size, bird.heading].every(Number.isFinite));
  scene.setEnvironment({ weather: null });
  const change = { eventId: 'reply', itemId: items[0].itemId, type: 'activity', expiresAt: Date.now() + 30_000 };
  scene.sync(items, [change]); assert.equal(positions(scene).get(change.itemId).activity, 1);
  advance(scene, 40); const activity = positions(scene).get(change.itemId).activity;
  scene.sync(items, [change]); assert.equal(positions(scene).get(change.itemId).activity, activity);
  advance(scene, 120); assert.equal(positions(scene).get(change.itemId).activity, 0);
  scene.sync(items, [{ ...change, eventId: 'expired', expiresAt: Date.now() - 100 }]);
  assert.equal(positions(scene).get(change.itemId).activity, 0);
  assert.throws(() => scene.sync([items[0], items[0]]), /duplicate/);
  assert.throws(() => scene.update(NaN), /finite/);
});
