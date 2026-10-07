import test from 'node:test';
import assert from 'node:assert/strict';
import { drawPigeon } from '../src/renderers/pigeons.js';

// Model saved Canvas state, including transforms, so a missing restore affects
// subsequent birds just as it would in the shared scene renderer.
function drawingContext() {
  const calls = [], stack = [];
  let state = { fillStyle: '#original-fill', strokeStyle: '#original-stroke', globalAlpha: 0.37, lineWidth: 2, lineCap: 'butt', transform: [1, 0, 0, 1, 20, 30], clips: 0 };
  const ctx = { calls, snapshot: () => structuredClone(state), stackSize: () => stack.length };
  for (const key of ['fillStyle', 'strokeStyle', 'globalAlpha', 'lineWidth', 'lineCap']) {
    Object.defineProperty(ctx, key, { get: () => state[key], set: value => { state[key] = value; } });
  }
  const record = (method, args) => {
    assert.ok(args.every(value => typeof value !== 'number' || Number.isFinite(value)), `${method} received non-finite coordinates`);
    calls.push({ method, args, fill: state.fillStyle, alpha: state.globalAlpha });
  };
  ctx.save = () => { record('save', []); stack.push(structuredClone(state)); };
  ctx.restore = () => { record('restore', []); assert.ok(stack.length > 0); state = stack.pop(); };
  ctx.translate = (x, y) => { record('translate', [x, y]); state.transform[4] += x; state.transform[5] += y; };
  ctx.scale = (x, y) => { record('scale', [x, y]); state.transform[0] *= x; state.transform[3] *= y; };
  ctx.rotate = value => { record('rotate', [value]); state.transform[1] = Math.sin(value); state.transform[2] = -Math.sin(value); };
  ctx.clip = () => { record('clip', []); state.clips++; };
  for (const method of ['beginPath', 'closePath', 'fill', 'stroke', 'moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'ellipse']) {
    ctx[method] = (...args) => record(method, args);
  }
  return ctx;
}
const bird = { birdId: 'pigeon/1', x: 120, y: 70, size: 9, heading: 0.7, wingPhase: 0, bank: 0, pose: 'flying', readState: 'unknown', activity: 0 };
const geometry = ctx => ctx.calls.filter(call => ['moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'ellipse'].includes(call.method));

test('pigeon flight poses draw finite geometry at flock viewing sizes and preserve caller state', () => {
  for (const size of [2, 7, 9, 12, 24]) for (const pose of ['flying', 'gliding', 'landing', 'takeoff', 'perched']) {
    for (const phase of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      const ctx = drawingContext(), before = ctx.snapshot();
      const input = Object.freeze({ ...bird, size, pose, wingPhase: phase, bank: -0.8, poseProgress: 0.75 });
      assert.equal(drawPigeon(ctx, input, { colour: '#3d4c46', alpha: 0.7 }), true);
      assert.ok(ctx.calls.some(call => call.method === 'fill'));
      assert.deepEqual(ctx.snapshot(), before);
      assert.equal(ctx.stackSize(), 0);
    }
  }
});

test('wingbeats flex flight geometry while a glide holds its wings still', () => {
  const draw = (pose, wingPhase) => {
    const ctx = drawingContext(); drawPigeon(ctx, { ...bird, pose, wingPhase }); return geometry(ctx);
  };
  assert.notDeepEqual(draw('flying', 0), draw('flying', Math.PI));
  assert.deepEqual(draw('gliding', 0), draw('gliding', Math.PI));
  assert.notDeepEqual(draw('landing', 0), draw('gliding', 0));
});

test('banking foreshortens opposite wings and heading follows the supplied velocity projection', () => {
  const ctx = drawingContext();
  drawPigeon(ctx, { ...bird, heading: -1.2, bank: 0.8 });
  assert.equal(ctx.calls.find(call => call.method === 'rotate').args[0], -1.2);
  const wingScales = ctx.calls.filter(call => call.method === 'scale').slice(1);
  assert.equal(wingScales.length, 2);
  assert.notEqual(Math.abs(wingScales[0].args[1]), Math.abs(wingScales[1].args[1]));
});

test('nearby pigeons gain two clipped wing bars per wing while distant birds stay simple', () => {
  const near = drawingContext(), far = drawingContext();
  drawPigeon(near, { ...bird, size: 8 });
  drawPigeon(far, { ...bird, size: 3 });
  assert.equal(near.calls.filter(call => call.method === 'stroke').length, 4);
  assert.equal(near.calls.filter(call => call.method === 'clip').length, 2);
  assert.equal(far.calls.filter(call => call.method === 'stroke').length, 0);
});

test('invalid projected geometry is rejected and optional non-finite fields are safe', () => {
  for (const field of ['x', 'y', 'size']) for (const value of [NaN, Infinity, -Infinity]) {
    const ctx = drawingContext();
    assert.equal(drawPigeon(ctx, { ...bird, [field]: value }), false);
    assert.equal(ctx.calls.length, 0);
  }
  for (const size of [0, -2]) assert.equal(drawPigeon(drawingContext(), { ...bird, size }), false);
  const ctx = drawingContext(), before = ctx.snapshot();
  assert.equal(drawPigeon(ctx, { ...bird, heading: NaN, wingPhase: Infinity, bank: -Infinity }, { alpha: NaN }), true);
  assert.deepEqual(ctx.snapshot(), before);
});


test('activity briefly resumes wingbeats and adds a restrained stroke without mutating the frame', () => {
  const draw = (pose, activity, wingPhase = 0) => {
    const input = Object.freeze({ ...bird, pose, activity, wingPhase });
    const beforeInput = { ...input };
    const ctx = drawingContext(), beforeContext = ctx.snapshot();
    drawPigeon(ctx, input);
    assert.deepEqual(input, beforeInput);
    assert.deepEqual(ctx.snapshot(), beforeContext);
    assert.equal(ctx.stackSize(), 0);
    return geometry(ctx);
  };
  assert.notDeepEqual(draw('flying', 0), draw('flying', 1));
  assert.notDeepEqual(draw('gliding', 0.6, 0), draw('gliding', 0.6, Math.PI));
  assert.deepEqual(draw('gliding', 0, 0), draw('gliding', 0, Math.PI));
  assert.deepEqual(draw('flying', 1), draw('flying', 100));
  assert.deepEqual(draw('flying', 0), draw('flying', NaN));
});
