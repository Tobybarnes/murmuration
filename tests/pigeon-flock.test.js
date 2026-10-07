import test from 'node:test';
import assert from 'node:assert/strict';
import { createWireSky } from '../src/scenes/wire-sky.js';
import { initialItems } from '../src/fixtures/wires.js';
const STEP = 1000 / 60;
const advance = (scene, frames) => { for (let i = 0; i < frames; i++) scene.update(STEP); };
const positions = scene => new Map(scene.getFrame().birds.map(bird => [bird.birdId, { ...bird }]));

// The circuit extends beyond the window, while keeping the flock coherent
// and its vertical flight between the title and controls on each device.
test('pigeons pass beyond both viewport edges and return as the same coherent flock', () => {
  for (const [width, height] of [[1200, 800], [390, 844], [844, 660]]) {
    const scene = createWireSky({ width, height }); scene.sync(initialItems());
    let previous = positions(scene), left = Infinity, right = -Infinity;
    let previousCentre = null, distanceTravelled = 0;
    const departedLeft = new Set(), departedRight = new Set(), returnedLeft = new Set(), returnedRight = new Set();
    const ids = [...previous.keys()].sort();
    for (let tick = 0; tick < 2400; tick++) {
      scene.update(STEP);
      const birds = scene.getFrame().birds;
      assert.deepEqual(birds.map(bird => bird.birdId).sort(), ids, 'offscreen birds keep representing the same items');
      assert.equal(Object.values(scene.getFrame().counts).reduce((sum, count) => sum + count.visible, 0), ids.length);
      const cx = birds.reduce((sum, bird) => sum + bird.x, 0) / birds.length;
      const cy = birds.reduce((sum, bird) => sum + bird.y, 0) / birds.length;
      if (previousCentre) distanceTravelled += Math.hypot(cx - previousCentre.x, cy - previousCentre.y);
      previousCentre = { x: cx, y: cy };
      left = Math.min(left, cx); right = Math.max(right, cx);
      const alignment = Math.hypot(birds.reduce((sum, bird) => sum + Math.cos(bird.heading), 0),
        birds.reduce((sum, bird) => sum + Math.sin(bird.heading), 0)) / birds.length;
      assert.ok(alignment > .75, 'birds follow a common heading instead of swirling independently');
      for (const bird of birds) {
        assert.ok([bird.x, bird.y, bird.heading, bird.size, bird.wingPhase, bird.bank].every(Number.isFinite));
        assert.ok(bird.x > -width * .2 && bird.x < width * 1.2, 'flight extends at most about 20% beyond each edge');
        if (bird.x < -bird.size * 2) departedLeft.add(bird.birdId);
        if (bird.x > width + bird.size * 2) departedRight.add(bird.birdId);
        if (bird.x > bird.size * 2 && bird.x < width - bird.size * 2) {
          if (departedLeft.has(bird.birdId)) returnedLeft.add(bird.birdId);
          if (departedRight.has(bird.birdId)) returnedRight.add(bird.birdId);
        }
        assert.ok(bird.y > 205 && bird.y < height - (width < 640 ? 310 : 235));
        assert.ok(Math.hypot(bird.x - cx, bird.y - cy) < width * .3, 'flock stays compact');
        const before = previous.get(bird.birdId);
        assert.ok(Math.hypot(bird.x - before.x, bird.y - before.y) < width * .011, 'flight remains continuous');
      }
      previous = positions(scene);
    }
    assert.ok(right - left > width, 'flock makes a circuit wider than the window');
    assert.ok(distanceTravelled > width * 4.4, 'flock travels briskly through several circuits in forty seconds');
    assert.ok(returnedLeft.size > 0 && returnedRight.size > 0, 'fully offscreen birds return from both sides');
    scene.dispose();
  }
});

test('faster travel retains real-time wingbeats and brief glides', () => {
  const scene = createWireSky(); scene.sync(initialItems());
  const initial = positions(scene);
  const glides = new Map([...initial].map(([id, bird]) => [id, {
    gliding: bird.pose === 'gliding', startedAt: null, starts: [], durations: [],
  }]));
  for (let tick = 1; tick <= 1800; tick++) {
    scene.update(STEP);
    const seconds = tick / 60;
    for (const bird of scene.getFrame().birds) {
      if (tick === 60) {
        const cycles = (bird.wingPhase - initial.get(bird.birdId).wingPhase) / (Math.PI * 2);
        assert.ok(cycles >= 5.7 - 1e-8 && cycles <= 6.5 + 1e-8, 'wingbeats keep their original cycles per real-time second');
      }
      const record = glides.get(bird.birdId), gliding = bird.pose === 'gliding';
      if (gliding && !record.gliding) { record.startedAt = seconds; record.starts.push(seconds); }
      if (!gliding && record.gliding && record.startedAt !== null) {
        record.durations.push(seconds - record.startedAt); record.startedAt = null;
      }
      record.gliding = gliding;
    }
  }
  const tolerance = STEP / 1000 + 1e-8;
  for (const record of glides.values()) {
    assert.ok(record.durations.length >= 2, 'each pigeon completes several glides');
    for (const duration of record.durations) {
      assert.ok(Math.abs(duration - .38) <= tolerance, 'glides keep their original real-time duration');
    }
    for (let i = 1; i < record.starts.length; i++) {
      const period = record.starts[i] - record.starts[i - 1];
      assert.ok(period >= 8 - tolerance && period <= 12 + tolerance, 'glides keep their original real-time spacing');
    }
  }
  scene.dispose();
});

test('batched updates preserve flight distance and animation timing', () => {
  const batched = createWireSky(), regular = createWireSky();
  batched.sync(initialItems()); regular.sync(initialItems());
  for (let tick = 0; tick < 200; tick++) {
    batched.update(50); advance(regular, 3);
    const reference = positions(regular);
    for (const bird of batched.getFrame().birds) {
      const expected = reference.get(bird.birdId);
      assert.ok(Math.hypot(bird.x - expected.x, bird.y - expected.y) < .01, 'elapsed flight time survives larger updates');
      assert.ok(Math.abs(bird.wingPhase - expected.wingPhase) < 1e-8, 'wingbeats follow elapsed real time');
      assert.equal(bird.pose, expected.pose);
    }
  }
  batched.dispose(); regular.dispose();
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
