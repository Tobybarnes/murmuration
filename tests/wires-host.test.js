import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';

const STEP = 1000 / 60;
class Element extends EventTarget {
  constructor(id) { super(); this.id = id; this.dataset = {}; this.children = []; this.attributes = {}; this.hidden = id === 'error'; this.disabled = false; this.value = ''; this.textContent = ''; }
  setAttribute(name, value) { this.attributes[name] = value; }
  replaceChildren(...children) { this.children = children; }
  append(child) { this.children.push(child); }
  closest() { return null; }
  click() { if (!this.disabled) this.dispatchEvent(new Event('click')); }
}

async function withHost(run) {
  const saved = new Map(), scheduled = new Map(), errors = [];
  const ids = ['wires', 'notice', 'replay', 'selected-item', 'read', 'archive', 'selected-state', 'pause', 'scene-wires', 'scene-sky', 'scene-caption', 'scene-detail', 'summary', 'overflow', 'play-state', 'new-email', 'agent-reply', 'reset', 'error', 'count-email', 'count-agents', 'count-other'];
  const elements = Object.fromEntries(ids.map(id => [id, new Element(id)]));
  const media = Object.assign(new EventTarget(), { matches: false });
  const window = Object.assign(new EventTarget(), { innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1 });
  const document = Object.assign(new EventTarget(), {
    hidden: false,
    getElementById: id => elements[id],
    createElement: tag => new Element(tag),
    querySelectorAll: selector => selector === '[data-lane]' ? [] : Object.values(elements),
  });
  const noop = () => {};
  const context = new Proxy({ createLinearGradient: () => ({ addColorStop: noop }) }, { get: (target, property) => property in target ? target[property] : noop });
  elements.wires.getContext = () => context;
  elements.wires.getBoundingClientRect = () => ({ width: window.innerWidth, height: window.innerHeight, left: 0, top: 0 });
  let now = 0, nextFrame = 1;
  const replacements = { window, document, matchMedia: () => media, performance: { now: () => now },
    requestAnimationFrame(callback) { const id = nextFrame++; scheduled.set(id, callback); return id; },
    cancelAnimationFrame(id) { scheduled.delete(id); },
  };
  for (const [key, value] of Object.entries(replacements)) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const originalError = console.error; console.error = error => errors.push(error);
  function advance(count, elapsed = STEP) {
    for (let index = 0; index < count; index++) {
      now += elapsed; const pending = [...scheduled.values()]; scheduled.clear();
      for (const callback of pending) callback(now);
    }
  }
  try {
    await import(`../src/wires-main.js?test=${Math.random()}`);
    assert.deepEqual(errors, []); assert.equal(elements.error.hidden, true);
    await run({ elements, advance, document, window, media, scheduled });
  } finally {
    window.dispatchEvent(new Event('pagehide'));
    console.error = originalError;
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

test('wire host pauses, resumes visibility without catch-up and removes browser resources', async () => {
  await withHost(({ elements, advance, document, window, scheduled }) => {
    advance(10); const before = Number(elements.wires.dataset.simTime);
    elements.pause.click(); advance(60); assert.equal(Number(elements.wires.dataset.simTime), before); assert.equal(scheduled.size, 0);
    elements.pause.click(); advance(2); assert.ok(Number(elements.wires.dataset.simTime) > before);
    document.hidden = true; document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(scheduled.size, 0); const hiddenAt = Number(elements.wires.dataset.simTime); advance(1, 30_000);
    document.hidden = false; document.dispatchEvent(new Event('visibilitychange')); advance(1);
    assert.ok(Number(elements.wires.dataset.simTime) - hiddenAt <= 18);
    window.dispatchEvent(new Event('pagehide')); assert.equal(scheduled.size, 0);
    assert.equal(getEventListeners(document, 'visibilitychange').length, 0);
    assert.equal(getEventListeners(window, 'resize').length, 0);
  });
});

test('sample reset, replay and scene switching preserve count semantics after elapsed time', async () => {
  await withHost(({ elements, advance }) => {
    advance(400); elements.reset.click(); advance(1);
    elements['new-email'].click(); advance(1); assert.equal(elements.wires.dataset.birdCount, '18');
    const ids = elements.wires.dataset.birdIds.split(',').sort();
    elements['scene-sky'].click(); advance(1); assert.deepEqual(elements.wires.dataset.birdIds.split(',').sort(), ids);
    elements['scene-wires'].click(); advance(1);
    elements.archive.click(); advance(140); assert.equal(elements.wires.dataset.birdCount, '17');
    elements.replay.click(); advance(640);
    assert.equal(elements.wires.dataset.birdCount, '18', 'sequence removes its email and keeps its new document');
    assert.equal(elements.replay.textContent, 'Play sequence');
  });
});

test('reduced-motion changes settle at rest while sample controls remain usable', async () => {
  await withHost(({ elements, advance, media, scheduled }) => {
    advance(10); media.matches = true;
    const change = new Event('change'); Object.defineProperty(change, 'matches', { value: true }); media.dispatchEvent(change); advance(1);
    assert.equal(elements.wires.dataset.paused, 'true'); assert.equal(scheduled.size, 0);
    const pausedAt = elements.wires.dataset.simTime;
    elements['new-email'].click(); advance(1);
    assert.equal(elements.wires.dataset.birdCount, '18'); assert.equal(elements.wires.dataset.simTime, pausedAt);
    elements.archive.click(); advance(1); assert.equal(elements.wires.dataset.visibleCount, '17');
  });
});
