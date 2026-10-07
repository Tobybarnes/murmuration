import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { createSimulation } from '../src/simulation.js';
import { PARAMS, resolveParameters } from '../src/parameters.js';

const STEP = 1000 / 60;
const defaults = () => PARAMS.map(parameter => parameter.def);

// Node has no Canvas or animation clock. Keep the simulation real and replace
// only those browser boundaries, with deterministic elapsed time and entropy.
function withBrowser(run) {
  const saved = new Map();
  let now = 0, nextFrame = 1, seed = 12345;
  const scheduled = new Map();
  const window = Object.assign(new EventTarget(), {
    innerWidth: 1200, innerHeight: 800, devicePixelRatio: 2,
  });
  const document = Object.assign(new EventTarget(), { hidden: false });
  const radii = [], labels = [];
  const context = {
    setTransform() {}, fillRect() {}, setLineDash() {}, beginPath() {},
    moveTo() {}, lineTo() {}, stroke() {}, fill() {},
    arc(x, y, radius) {
      assert.ok([x, y, radius].every(Number.isFinite), 'Canvas received a non-finite point');
      assert.ok(radius >= 0, 'Canvas received a negative radius');
      radii.push(radius);
    },
    fillText(label) { labels.push(label); },
  };
  const canvas = {
    width: 0, height: 0,
    getContext: () => context,
    getBoundingClientRect: () => ({ width: window.innerWidth, height: window.innerHeight }),
  };
  const replacements = {
    window, document, performance: { now: () => now },
    requestAnimationFrame(callback) {
      const id = nextFrame++;
      scheduled.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) { scheduled.delete(id); },
  };
  for (const [key, value] of Object.entries(replacements)) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const originalRandom = Math.random;
  Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const frame = (elapsed = STEP) => {
    now += elapsed;
    const pending = [...scheduled.values()];
    scheduled.clear();
    for (const callback of pending) callback(now);
  };
  const advance = (count, elapsed = STEP) => {
    for (let index = 0; index < count; index++) frame(elapsed);
  };
  try {
    return run({ window, document, canvas, frame, advance, scheduled, radii, labels });
  } finally {
    Math.random = originalRandom;
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

test('the extracted flock evolves without invalid state or unsafe canvas coordinates', () => {
  withBrowser(({ canvas, advance, labels }) => {
    const simulation = createSimulation(canvas);
    const opening = simulation.getState();
    assert.equal(opening.count, 456);
    advance(120);
    const evolved = simulation.getState();
    assert.equal(evolved.finite, true);
    assert.ok(evolved.simTime > 1900);
    assert.notDeepEqual(evolved.positions, opening.positions);
    for (const velocity of evolved.velocities) {
      const speed = Math.hypot(...velocity);
      assert.ok(speed <= evolved.parameters.speed + 0.00001);
      assert.ok(speed >= evolved.parameters.speed * 0.55 - 0.00001);
    }
    assert.ok(labels.length > 0);
    assert.ok(labels.every(label => /^sim-\d+$/.test(label)));
    evolved.positions[0][0] = Infinity;
    assert.equal(simulation.getState().finite, true, 'diagnostic snapshots must not expose mutable engine state');
    simulation.destroy();
  });
});

test('maximum density and force settings stay within the supported flock capacity', () => {
  withBrowser(({ canvas, advance }) => {
    const simulation = createSimulation(canvas, { values: Array(16).fill(1) });
    advance(30);
    const state = simulation.getState();
    assert.equal(state.count, 2400);
    assert.equal(state.positions.length, 2400);
    assert.equal(state.finite, true);
    assert.ok(state.links <= 7200);
    simulation.destroy();
  });
});

test('pause freezes simulation time and movement while visual parameters still redraw', () => {
  withBrowser(({ canvas, advance, radii }) => {
    const simulation = createSimulation(canvas);
    advance(5);
    simulation.setPaused(true);
    const paused = simulation.getState();
    simulation.setParameter(9, 1);
    radii.length = 0;
    advance(90);
    const edited = simulation.getState();
    assert.equal(edited.simTime, paused.simTime);
    assert.deepEqual(edited.positions, paused.positions);
    assert.deepEqual(edited.velocities, paused.velocities);
    assert.ok(edited.frames > paused.frames);
    assert.ok(radii.some(radius => radius > 8));
    simulation.setPaused(false);
    advance(2);
    assert.ok(simulation.getState().simTime > paused.simTime);
    simulation.destroy();
  });
});

test('invalid input is rejected atomically and finite values are clamped', () => {
  withBrowser(({ canvas, advance }) => {
    const simulation = createSimulation(canvas);
    const previous = simulation.getState().values;
    for (const bad of [NaN, Infinity, -Infinity, '0.5', null]) {
      assert.throws(() => simulation.setParameter(0, bad));
    }
    for (const index of [-1, 16, 0.5, NaN]) {
      assert.throws(() => simulation.setParameter(index, 0.5));
    }
    const invalid = defaults();
    invalid[0] = 1;
    invalid[15] = NaN;
    assert.throws(() => simulation.setParameters(invalid));
    assert.throws(() => simulation.setParameters([0.5]));
    assert.throws(() => simulation.setPointer(NaN, 0, true));
    assert.throws(() => resolveParameters(invalid));
    assert.deepEqual(simulation.getState().values, previous);
    simulation.setParameter(0, 9);
    assert.equal(simulation.getState().values[0], 1);
    simulation.setParameter(0, -9);
    advance(90);
    assert.equal(simulation.getState().count, 40);
    assert.equal(simulation.getState().finite, true);
    simulation.destroy();
  });
});

test('60Hz and 120Hz displays produce the same motion after equal elapsed time', () => {
  const run = (frameCount, elapsed) => withBrowser(({ canvas, advance }) => {
    const values = defaults();
    values[0] = 0;
    const simulation = createSimulation(canvas, { values });
    advance(frameCount, elapsed);
    const state = simulation.getState();
    simulation.destroy();
    return state;
  });
  const sixty = run(60, STEP);
  const oneTwenty = run(120, STEP / 2);
  assert.equal(sixty.simTime, oneTwenty.simTime);
  assert.deepEqual(sixty.positions, oneTwenty.positions);
  assert.deepEqual(sixty.velocities, oneTwenty.velocities);
});

test('background tabs stop scheduling and resume without simulating the hidden interval', () => {
  withBrowser(({ canvas, document, advance, frame, scheduled }) => {
    const simulation = createSimulation(canvas);
    advance(5);
    const before = simulation.getState().simTime;
    document.hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(scheduled.size, 0);
    frame(30000);
    assert.equal(simulation.getState().simTime, before);
    document.hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    frame();
    assert.ok(simulation.getState().simTime - before <= STEP + 0.0001);
    const resumed = simulation.getState().simTime;
    frame(1000);
    assert.ok(simulation.getState().simTime - resumed <= 50.0001, 'a stalled frame must run at most three updates');
    simulation.destroy();
  });
});

test('destroy removes browser resources and prevents resize or visibility from restarting work', () => {
  withBrowser(({ canvas, window, document, scheduled, frame }) => {
    const simulation = createSimulation(canvas);
    simulation.destroy();
    simulation.destroy();
    const before = simulation.getState();
    const width = canvas.width;
    assert.equal(scheduled.size, 0);
    assert.equal(getEventListeners(window, 'resize').length, 0);
    assert.equal(getEventListeners(document, 'visibilitychange').length, 0);
    window.innerWidth = 900;
    window.dispatchEvent(new Event('resize'));
    document.dispatchEvent(new Event('visibilitychange'));
    frame();
    assert.equal(canvas.width, width);
    assert.equal(simulation.getState().frames, before.frames);
  });
});

test('reset restores the default flock and palette callbacks contain usable CSS colors', () => {
  withBrowser(({ canvas, advance }) => {
    const palettes = [], statistics = [];
    const values = defaults();
    values[0] = 1;
    const simulation = createSimulation(canvas, {
      values, paused: true,
      onPalette: palette => palettes.push(palette),
      onStats: stats => statistics.push(stats),
    });
    assert.equal(palettes[0].bg, 'rgb(21,50,67)');
    simulation.setParameter(15, 1);
    advance(90);
    assert.equal(palettes.at(-1).bg, 'rgb(232,232,230)');
    assert.match(palettes.at(-1).panel, /^rgba\(/);
    assert.ok(statistics.length >= 3);
    assert.ok(statistics.every(stats => stats.count === 2400 && stats.paused && Number.isFinite(stats.fps)));
    const before = simulation.getState().positions;
    simulation.scatter();
    assert.notDeepEqual(simulation.getState().positions, before);
    simulation.reset();
    assert.equal(simulation.getState().count, 456);
    assert.deepEqual(simulation.getState().values, defaults());
    assert.equal(simulation.getState().paused, true);
    simulation.destroy();
  });
});

test('missing Canvas 2D support fails explicitly before allocating browser resources', () => {
  withBrowser(({ window, document, scheduled }) => {
    assert.throws(() => createSimulation({ getContext: () => null }), /2D/);
    assert.equal(scheduled.size, 0);
    assert.equal(getEventListeners(window, 'resize').length, 0);
    assert.equal(getEventListeners(document, 'visibilitychange').length, 0);
  });
});
