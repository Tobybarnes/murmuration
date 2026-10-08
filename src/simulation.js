// Flocking and Canvas rendering adapted from Ben Bashford's Murmuration.
// https://benbashford.com/experiments/murmuration/murmuration.html
// Original source retrieved 2026-10-07. See ATTRIBUTION.md for provenance.
// The host owns UI, persistence and input; this module owns its frame loop.
import { PARAMS, resolveParameters } from './parameters.js';
import { createSkyScene } from './scenes/sky.js';
import { createCanvasRenderer } from './renderers/canvas.js';

const STEP_MS = 1000 / 60;
const MAX_STEPS_PER_FRAME = 3;

function normalizeValues(values) {
  resolveParameters(values); // Validate the entire update before changing state.
  return values.map(value => Math.max(0, Math.min(1, value)));
}

export function createSimulation(canvas, {
  values = PARAMS.map(parameter => parameter.def),
  paused = false,
  appearance = 'dots',
  onStats = () => {},
  onPalette = () => {},
} = {}) {
  const ctx = canvas?.getContext?.('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable in this browser.');
  if (typeof onStats !== 'function' || typeof onPalette !== 'function') {
    throw new TypeError('Simulation callbacks must be functions.');
  }
  if (!['dots', 'birds'].includes(appearance)) throw new TypeError('Appearance must be dots or birds.');
  let scene;
  let overlays = appearance === 'dots';
  const renderer = createCanvasRenderer(ctx);
  const target = normalizeValues(values);
  const cur = target.slice();
  let P = resolveParameters(cur);
  paused = Boolean(paused);
  let destroyed = false, dirty = true, rafId = null;
  let frames = 0, simTime = 0, accumulator = 0;
  let last = performance.now(), statsTime = last, statsFrames = 0, fps = 0;

  // ---------------------------------------------------------------------------
  // Earth tones, blended by the Dark/Light fader.
  // ---------------------------------------------------------------------------
  const DARK  = { bg: [38, 57, 46],   fg: [238, 229, 210], accent: [196, 166, 122], hover: [159, 172, 143] };
  const LIGHT = { bg: [238, 230, 214], fg: [53, 67, 51],    accent: [132, 95, 65], hover: [102, 121, 93] };
  const C = {};
  const mix = (a, b, t) => a.map((x, k) => Math.round(x + (b[k] - x) * t));
  const rgb = (c, a = 1) => a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  let lastTheme = -1;
  function updateColours() {
    const t = P.theme;
    if (Math.abs(t - lastTheme) < 0.002) return;
    lastTheme = t;
    for (const k of Object.keys(DARK)) C[k] = mix(DARK[k], LIGHT[k], t);
    // Keep birds and labels visible as the light and dark colours cross.
    const luminance = colour => {
      const c = colour.map(value => {
        const channel = value / 255;
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
      });
      return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
    };
    const background = luminance(C.bg);
    for (const key of ['fg', 'accent', 'hover']) {
      const minimum = key === 'fg' ? 4.5 : 3;
      C[key] = [C[key], DARK[key], LIGHT[key], [255, 254, 248], [2, 4, 2]].find(colour => {
        const foreground = luminance(colour);
        return (Math.max(background, foreground) + .05) / (Math.min(background, foreground) + .05) >= minimum;
      });
    }
    onPalette({
      bg: rgb(C.bg), fg: rgb(C.fg), accent: rgb(C.accent),
      hover: rgb(C.hover), panel: rgb(C.bg, 0.82),
    });
  }

  // ---------------------------------------------------------------------------
  // Canvas
  // ---------------------------------------------------------------------------
  let W = 0, H = 0, DPR = 1;
  function resize() {
    if (destroyed) return;
    const rect = canvas.getBoundingClientRect?.();
    const width = rect?.width || window.innerWidth;
    const height = rect?.height || window.innerHeight;
    W = Number.isFinite(width) && width > 0 ? width : 1;
    H = Number.isFinite(height) && height > 0 ? height : 1;
    const ratio = window.devicePixelRatio || 1;
    DPR = Number.isFinite(ratio) ? Math.max(0.1, Math.min(ratio, 2)) : 1;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = rgb(C.bg || DARK.bg);
    ctx.fillRect(0, 0, W, H);
    scene?.resize({ width: W, height: H });
    dirty = true;
  }

  function smoothParameters() {
    let changed = false;
    for (let i = 0; i < PARAMS.length; i++) {
      const difference = target[i] - cur[i];
      if (difference === 0) continue;
      // Same 0.18 smoothing as the source at 60Hz. Applying it on fixed ticks
      // makes both parameter response and flock steering independent of RAF rate.
      cur[i] = Math.abs(difference) < 0.000001 ? target[i] : cur[i] + difference * 0.18;
      changed = true;
    }
    if (changed) {
      P = resolveParameters(cur);
      updateColours();
      scene.setParameters(cur);
      dirty = true;
    }
  }

  function render() {
    renderer.draw(scene.getFrame(), { colours: C, appearance, connections: overlays, labels: overlays });
    frames++;
    statsFrames++;
    dirty = false;
  }

  function schedule() {
    if (!destroyed && !document.hidden && rafId === null) {
      rafId = requestAnimationFrame(frame);
    }
  }

  function frame(now) {
    rafId = null;
    if (destroyed || document.hidden) return;
    const elapsed = Math.max(0, now - last);
    last = now;
    accumulator = Math.min(accumulator + elapsed, STEP_MS * MAX_STEPS_PER_FRAME);
    let steps = 0;
    while (accumulator + 0.0000001 >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
      smoothParameters();
      if (!paused) {
        simTime += STEP_MS;
        scene.update(STEP_MS, simTime);
      }
      accumulator = Math.max(0, accumulator - STEP_MS);
      steps++;
    }
    if (!paused || dirty) {
      render();
    }
    if (now - statsTime >= 500) {
      fps = Math.round(statsFrames * 1000 / (now - statsTime));
      onStats({ count: scene.getFrame().birds.length, fps, paused });
      statsTime = now;
      statsFrames = 0;
    }
    schedule();
  }

  function visibilityChanged() {
    if (destroyed) return;
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
    accumulator = 0;
    last = performance.now();
    statsTime = last;
    statsFrames = 0;
    dirty = true;
    schedule();
  }

  function setParameter(index, value) {
    if (!Number.isInteger(index) || index < 0 || index >= PARAMS.length) {
      throw new RangeError(`Parameter index must be between 0 and ${PARAMS.length - 1}.`);
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError('A normalized parameter must be a finite number.');
    }
    if (destroyed) return;
    target[index] = Math.max(0, Math.min(1, value));
    dirty = true;
  }

  function setParameters(values) {
    const normalized = normalizeValues(values);
    if (destroyed) return;
    normalized.forEach((value, index) => { target[index] = value; });
    dirty = true;
  }

  function reset() {
    if (destroyed) return;
    PARAMS.forEach((parameter, index) => { target[index] = cur[index] = parameter.def; });
    P = resolveParameters(cur);
    lastTheme = -1;
    updateColours();
    scene.reset();
    simTime = 0;
    accumulator = 0;
    last = performance.now();
    dirty = true;
  }

  function scatter() {
    if (destroyed) return;
    scene.scatter();
    dirty = true;
  }

  function setPaused(value) {
    if (destroyed) return;
    paused = Boolean(value);
    accumulator = 0;
    last = performance.now();
    dirty = true;
  }

  function setPointer(x, y, down) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new TypeError('Pointer coordinates must be finite numbers.');
    }
    if (destroyed) return;
    scene.setPointer(x, y, down);
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
    window.removeEventListener('resize', resize);
    document.removeEventListener('visibilitychange', visibilityChanged);
    scene.dispose();
  }

  function getState() {
    return {
      ...scene.getState(), paused, frames, values: target.slice(), fps, destroyed,
      appearance, overlays,
    };
  }

  function setAppearance(next) {
    if (!['dots', 'birds'].includes(next)) throw new TypeError('Appearance must be dots or birds.');
    if (destroyed) return;
    appearance = next;
    overlays = next === 'dots';
    dirty = true;
  }

  function setOverlays(value) {
    if (destroyed) return;
    overlays = Boolean(value);
    dirty = true;
  }

  function sync(items, changes) {
    if (destroyed) return;
    scene.sync(items, changes);
    dirty = true;
  }

  function setEnvironment(environment) {
    if (destroyed) return;
    scene.setEnvironment(environment);
    dirty = true;
  }

  updateColours();
  resize();
  scene = createSkyScene({ width: W, height: H, values: cur });
  if (!document.hidden) render();
  onStats({ count: scene.getFrame().birds.length, fps: 0, paused });
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', visibilityChanged);
  schedule();

  return {
    setParameter, setParameters, reset, scatter, setPaused, setPointer,
    resize, destroy, getState, getFrame: () => scene.getFrame(),
    sync, setEnvironment, setAppearance, setOverlays,
  };
}
