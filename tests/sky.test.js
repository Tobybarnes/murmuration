import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSkyScene } from '../src/scenes/sky.js';
import { PARAMS } from '../src/parameters.js';

function withSeed(run) {
  let seed = 12345;
  const random = Math.random;
  Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  try { return run(); } finally { Math.random = random; }
}
const digest = scene => {
  const { positions, velocities } = scene.getState();
  return createHash('sha256').update(JSON.stringify([positions, velocities])).digest('hex');
};
const STEP = 1000 / 60;

test('extracted sky preserves baseline dot positions and velocities exactly', () => withSeed(() => {
  // Recorded from bb0cf87's original simulation at 1200 × 800, seed 12345.
  const expected = [
    '6e38fde7c971cb6c57212f486eeef4a3c06fd34091241fd1fc110d51eee02b7b',
    '74369b2b00174a6a34f50ffdb3d7ad70df5e52ddb43fa36360e28cbace608ea9',
    '9761d09e315deb0e96a9328fdc752c0fa7836dd28b7b4ad48fd9a61366421bf1',
  ];
  const scene = createSkyScene();
  let time = 0;
  for (const hash of expected) {
    assert.equal(digest(scene), hash);
    for (let step = 0; step < 60; step++) { time += STEP; scene.update(STEP, time); }
  }
  scene.dispose();
}));

test('snapshots retain surviving bird identity and movement when reordered or removed', () => {
  const scene = createSkyScene();
  scene.sync([{ itemId: 'email/a' }, { itemId: 'email/b' }, { itemId: 'agent/a' }]);
  scene.update(STEP, STEP);
  const frame = scene.getFrame();
  const bird = frame.birds[1];
  const position = [bird.x, bird.y];
  scene.sync([{ itemId: 'email/b', readState: 'read' }, { itemId: 'email/a' }]);
  assert.equal(scene.getFrame(), frame);
  assert.equal(frame.birds[0], bird);
  assert.equal(bird.readState, 'read');
  assert.deepEqual([bird.x, bird.y], position);
  assert.equal(frame.birds.length, 2);
  assert.throws(() => scene.sync([{ itemId: 'email/b' }, { itemId: 'email/b' }]));
  assert.equal(frame.birds.length, 2);
});

test('empty and single-item inputs ignore the classic minimum and keep predator geometry finite', () => {
  const values = PARAMS.map(p => p.def); values[12] = 1;
  const scene = createSkyScene({ values });
  for (const items of [[], [{ itemId: 'email/only' }], []]) {
    scene.sync(items);
    scene.update(STEP, STEP);
    assert.equal(scene.getState().count, items.length);
    assert.equal(scene.getState().finite, true);
    if (!items.length) assert.equal(scene.getFrame().geometry.find(g => g.type === 'predator').on, false);
  }
});

test('repeated activity events cannot restart a bird response', () => {
  const scene = createSkyScene();
  const items = [{ itemId: 'a' }];
  scene.sync([]);
  const changes = [{ eventId: 'arrived', itemId: 'a', type: 'activity', expiresAt: Date.now() + 10000 }];
  scene.sync(items, changes);
  scene.update(1000, 1000);
  const before = scene.getFrame().birds[0].activity;
  scene.sync(items, changes);
  assert.equal(scene.getFrame().birds[0].activity, before);
});

test('drawing reads and paused refreshes do not advance wing motion or heading', () => {
  const scene = createSkyScene();
  scene.update(STEP, STEP);
  const { wingPhase, heading, bank } = scene.getFrame().birds[0];
  scene.resize({ width: 375, height: 812 });
  scene.setParameters(PARAMS.map(p => p.def));
  assert.equal(scene.getFrame().birds[0].wingPhase, wingPhase);
  assert.equal(scene.getFrame().birds[0].heading, heading);
  assert.equal(scene.getFrame().birds[0].bank, bank);
  assert.throws(() => scene.update(NaN));
  assert.throws(() => scene.resize({ width: 0, height: 10 }));
});

test('fresh ambient state affects movement without creating birds and stale state is ignored', () => {
  const run = (environment) => withSeed(() => {
    const scene = createSkyScene();
    scene.setEnvironment(environment);
    scene.update(STEP, STEP);
    return { digest: digest(scene), count: scene.getFrame().birds.length };
  });
  const baseline = run({});
  const fresh = run({ weather: { expiresAt: Date.now() + 60000, windKph: 80, windDirection: 90 }, listening: { expiresAt: Date.now() + 60000, playing: true } });
  const stale = run({ weather: { expiresAt: 0, windKph: 80, windDirection: 90 } });
  assert.equal(fresh.count, baseline.count);
  assert.notEqual(fresh.digest, baseline.digest);
  assert.deepEqual(stale, baseline);
});


test('the first item snapshot populates quietly without replaying arrival events', () => {
  const scene = createSkyScene();
  scene.sync([{ itemId: 'email/existing' }], [{ eventId: 'snapshot', itemId: 'email/existing', type: 'upsert', expiresAt: Date.now() + 60000 }]);
  const bird = scene.getFrame().birds[0];
  assert.equal(bird.activity, 0);
  assert.ok(bird.x > 0 && bird.x < 1200);
});


test('targetless activity animates a bounded subset without adding birds or replaying', () => {
  const scene = createSkyScene();
  const items = Array.from({ length: 20 }, (_, i) => ({ itemId: `item/${i}` }));
  scene.sync(items);
  const changes = [{ eventId: 'listen/track/1', sourceId: 'lastfm', itemId: '', type: 'activity', expiresAt: Date.now() + 10000 }];
  scene.sync(items, changes);
  const active = scene.getFrame().birds.filter(bird => bird.activity > 0);
  assert.equal(active.length, 7);
  assert.equal(scene.getFrame().birds.length, 20);
  assert.ok(active.every(bird => bird.pose === 'flying'));
  scene.update(1000, 1000);
  const response = active.map(bird => bird.activity);
  scene.sync(items, changes);
  assert.deepEqual(active.map(bird => bird.activity), response);
});


test('reset clears activity deadlines when simulation time returns to zero', () => {
  const scene = createSkyScene();
  const items = [{ itemId: 'email/active' }];
  scene.sync(items);
  scene.update(STEP, 60000);
  const changes = [{ eventId: 'activity/late', itemId: 'email/active', type: 'activity', expiresAt: Date.now() + 10000 }];
  scene.sync(items, changes);
  assert.equal(scene.getFrame().birds[0].activity, 1);
  scene.reset();
  assert.equal(scene.getFrame().time, 0);
  assert.equal(scene.getFrame().birds[0].activity, 0);
  assert.equal(scene.getFrame().birds[0].activityUntil, 0);
  // Reset must not let the next repeated input snapshot replay that event.
  scene.sync(items, changes);
  assert.equal(scene.getFrame().birds[0].activity, 0);
});
