import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneFrame, sceneBirdId, birdVariation, BIRD_POSES } from '../src/scene-contract.js';
import { drawBird } from '../src/renderers/birds.js';

function drawingContext() {
  const calls = [];
  const context = { calls, fillStyle: 'original', strokeStyle: 'original', globalAlpha: 0.5 };
  for (const method of ['save', 'restore', 'beginPath', 'closePath', 'fill', 'stroke', 'translate', 'rotate', 'scale', 'moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'ellipse']) {
    context[method] = (...args) => {
      assert.ok(args.every(value => typeof value !== 'number' || Number.isFinite(value)), `${method} received non-finite geometry`);
      calls.push({ method, args });
    };
  }
  return context;
}

test('canonical item identities survive projection and variation stays tied to the ID', () => {
  assert.equal(sceneBirdId({ itemId: 'owner/account/email/123', birdId: 'stale-slot' }), 'owner/account/email/123');
  assert.equal(sceneBirdId({ birdId: 'sim-0001' }), 'sim-0001');
  assert.throws(() => sceneBirdId({ itemId: '' }));
  assert.deepEqual(birdVariation('item-a'), birdVariation('item-a'));
  assert.notDeepEqual(birdVariation('item-a'), birdVariation('item-b'));
  const frame = createSceneFrame(1200, 800);
  frame.birds.push({ birdId: 'item-a' });
  assert.equal(frame.birds[0].birdId, 'item-a');
  assert.equal(frame.time, 0);
});

test('every shared bird pose draws finite tapered geometry and balances canvas transforms', () => {
  for (const pose of BIRD_POSES) {
    for (const progress of [0, 0.5, 1]) {
      const context = drawingContext();
      drawBird(context, { birdId: 'test', x: 100, y: 200, size: 9, heading: 1.4, wingPhase: 2, bank: -0.6, pose, poseProgress: progress, activity: 0.5, readState: 'unread' }, { colour: '#263c40', alpha: 0.8 });
      assert.equal(context.calls[0].method, 'save');
      assert.equal(context.calls.at(-1).method, 'restore');
      assert.ok(context.calls.some(call => call.method === 'bezierCurveTo'));
      assert.ok(context.calls.some(call => call.method === 'fill'));
    }
  }
});

test('wing phase changes the silhouette while perched feet use the supplied wire anchor', () => {
  const a = drawingContext(), b = drawingContext(), perched = drawingContext();
  const bird = { birdId: 'a', x: 15, y: 25, size: 8, heading: 0, pose: 'flying', bank: 0 };
  drawBird(a, { ...bird, wingPhase: 0 });
  drawBird(b, { ...bird, wingPhase: Math.PI });
  assert.notDeepEqual(a.calls, b.calls);
  drawBird(perched, { ...bird, pose: 'perched', facing: -1 });
  assert.deepEqual(perched.calls.find(call => call.method === 'translate').args, [15, 25]);
  assert.ok(perched.calls.some(call => call.method === 'lineTo' && call.args[1] === 0));
});

test('invalid bird geometry never reaches Canvas', () => {
  for (const field of ['x', 'y', 'size']) {
    const context = drawingContext();
    drawBird(context, { x: 0, y: 0, size: 8, [field]: NaN });
    assert.equal(context.calls.length, 0);
  }
});
