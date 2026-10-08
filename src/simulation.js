// Flocking and Canvas rendering adapted from Ben Bashford's Murmuration.
// https://benbashford.com/experiments/murmuration/murmuration.html
// Original source retrieved 2026-10-07. See ATTRIBUTION.md for provenance.
// The host owns UI, persistence and input; this module owns its frame loop.
import { PARAMS, resolveParameters } from './parameters.js';

const STEP_MS = 1000 / 60;
const MAX_STEPS_PER_FRAME = 3;

function normalizeValues(values) {
  resolveParameters(values); // Validate the entire update before changing state.
  return values.map(value => Math.max(0, Math.min(1, value)));
}

export function createSimulation(canvas, {
  values = PARAMS.map(parameter => parameter.def),
  paused = false,
  onStats = () => {},
  onPalette = () => {},
} = {}) {
  const ctx = canvas?.getContext?.('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable in this browser.');
  if (typeof onStats !== 'function' || typeof onPalette !== 'function') {
    throw new TypeError('Simulation callbacks must be functions.');
  }
  const target = normalizeValues(values);
  const cur = target.slice();
  let P = resolveParameters(cur);
  paused = Boolean(paused);
  let destroyed = false, dirty = true, rafId = null;
  let frames = 0, simTime = 0, accumulator = 0;
  let last = performance.now(), statsTime = last, statsFrames = 0, fps = 0;

  // ---------------------------------------------------------------------------
  // Colours: the site's two themes, blended by the Dark/Light fader.
  // ---------------------------------------------------------------------------
  const DARK  = { bg: [38, 57, 46],    fg: [238, 229, 210], accent: [196, 166, 122], hover: [159, 172, 143] };
  const LIGHT = { bg: [238, 230, 214], fg: [53, 67, 51],    accent: [132, 95, 65],   hover: [102, 121, 93] };
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
    dirty = true;
  }

  // ---------------------------------------------------------------------------
  // Flock. 3D boids (so the flock can fold and thin like the real thing),
  // projected with perspective onto the screen.
  // ---------------------------------------------------------------------------
  const MAX = 2400;
  const px = new Float32Array(MAX), py = new Float32Array(MAX), pz = new Float32Array(MAX);
  const vx = new Float32Array(MAX), vy = new Float32Array(MAX), vz = new Float32Array(MAX);
  const sx = new Float32Array(MAX), sy = new Float32Array(MAX), sr = new Float32Array(MAX);
  const linked = new Uint8Array(MAX);
  // Adaptation: these are explicitly simulated IDs. The original's invented
  // country codes are omitted so nodes cannot be mistaken for real messages.
  const ids = [];

  let N = 0;
  function bounds() { return { bx: W * 0.38, by: H * 0.34, bz: Math.min(W, H) * 0.3 }; }
  function spawn(i, near) {
    const b = bounds();
    if (near !== undefined && N > 0) {
      const j = (Math.random() * N) | 0;
      px[i] = px[j] + (Math.random() - .5) * 20; py[i] = py[j] + (Math.random() - .5) * 20; pz[i] = pz[j] + (Math.random() - .5) * 20;
      vx[i] = vx[j]; vy[i] = vy[j]; vz[i] = vz[j];
    } else {
      px[i] = (Math.random() - .5) * b.bx * 1.6; py[i] = (Math.random() - .5) * b.by * 1.6; pz[i] = (Math.random() - .5) * b.bz * 1.6;
      const a = Math.random() * Math.PI * 2;
      vx[i] = Math.cos(a) * 2; vy[i] = Math.sin(a) * 2; vz[i] = (Math.random() - .5);
    }
    ids[i] = ids[i] || `sim-${String(i + 1).padStart(4, '0')}`;
  }
  function setCount(n) {
    n = Math.max(1, Math.min(MAX, Math.round(n)));
    while (N < n) { spawn(N, true); N++; }
    N = n;
  }
  function scatterFlock() { for (let i = 0; i < N; i++) spawn(i); }
  // Opening state: one loose cloud all heading roughly the same way.
  function gather() {
    const a = Math.random() * Math.PI * 2;
    for (let i = 0; i < N; i++) {
      spawn(i);
      const g = () => (Math.random() + Math.random() + Math.random() - 1.5) * 160;
      px[i] = g() * 1.6; py[i] = g(); pz[i] = g();
      vx[i] = Math.cos(a) * 2 + (Math.random() - .5); vy[i] = Math.sin(a) * 2 + (Math.random() - .5); vz[i] = Math.random() - .5;
    }
  }

  // Spatial hash (counting sort into a fixed table; collisions only add
  // candidates that the distance test then throws away).
  const TS = 8192, MASK = TS - 1;
  const cellCount = new Int32Array(TS + 1), cellStart = new Int32Array(TS + 1);
  const cellOf = new Int32Array(MAX), sorted = new Int32Array(MAX);
  const hash = (ix, iy, iz) => ((ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791)) & MASK;
  let cell = 50;
  function buildGrid() {
    cellCount.fill(0);
    for (let i = 0; i < N; i++) {
      const k = hash(Math.floor(px[i] / cell), Math.floor(py[i] / cell), Math.floor(pz[i] / cell));
      cellOf[i] = k; cellCount[k]++;
    }
    let acc = 0;
    for (let k = 0; k < TS; k++) { cellStart[k] = acc; acc += cellCount[k]; }
    cellStart[TS] = acc;
    const fillPos = cellCount; // reuse as cursor
    for (let k = 0; k < TS; k++) fillPos[k] = cellStart[k];
    for (let i = 0; i < N; i++) sorted[fillPos[cellOf[i]]++] = i;
  }

  // Links collected during the neighbour pass, drawn afterwards.
  const MAX_LINKS = MAX * 3;
  const la = new Int32Array(MAX_LINKS), lb = new Int32Array(MAX_LINKS), ld = new Float32Array(MAX_LINKS);
  let L = 0;

  // Predator + attractor
  const pred = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, on: false };
  const mouse = { x: 0, y: 0, down: false };

  const NEIGHBOUR_CAP = 14;   // starlings track roughly 7; a bit more reads smoother on screen
  const CANDIDATE_CAP = 160;   // keeps dense clumps from going quadratic
  const LINKS_PER_NODE = 3;
  const FOCAL = 1600;

  const seenKeys = new Int32Array(27);
  const OFF = [0, -1, 1];
  function step(dt, t) {
    const b = bounds();
    const R = P.vision, R2 = R * R;
    const S = P.space, S2 = S * S;
    const LD = P.link, LD2 = LD * LD;
    cell = Math.max(R, LD, 12);
    buildGrid();
    L = 0;
    linked.fill(0, 0, N);

    const maxV = P.speed, minV = maxV * 0.55;
    const wSep = P.sep * 0.6, wAli = P.align, wCoh = P.coh;
    const turb = P.turb * 0.25, att = P.attract * 0.12;

    // Attractor: a slow Lissajous wander, or the pointer while held.
    let ax, ay, az;
    if (mouse.down) { ax = mouse.x - W / 2; ay = mouse.y - H / 2; az = 0; }
    else {
      ax = Math.sin(t * 0.00011) * b.bx * 0.7;
      ay = Math.sin(t * 0.00017 + 1.3) * b.by * 0.6;
      az = Math.sin(t * 0.00013 + 0.4) * b.bz * 0.7;
    }

    // Predator chases the flock's centre of mass with a lag.
    pred.on = P.pred > 0.02;
    const fleeR = 60 + P.pred * 220, fleeR2 = fleeR * fleeR;
    if (pred.on) {
      let cx = 0, cy = 0, cz = 0;
      const stride = Math.max(1, (N / 200) | 0);
      let c = 0;
      for (let i = 0; i < N; i += stride) { cx += px[i]; cy += py[i]; cz += pz[i]; c++; }
      cx /= c; cy /= c; cz /= c;
      const dx = cx - pred.x, dy = cy - pred.y, dz = cz - pred.z;
      const d = Math.hypot(dx, dy, dz) || 1;
      const pv = maxV * (1.1 + P.pred * 0.6);
      pred.vx += (dx / d * pv - pred.vx) * 0.04 * dt + Math.sin(t * 0.003) * 0.3;
      pred.vy += (dy / d * pv - pred.vy) * 0.04 * dt + Math.cos(t * 0.0023) * 0.3;
      pred.vz += (dz / d * pv - pred.vz) * 0.04 * dt;
      pred.x += pred.vx * dt; pred.y += pred.vy * dt; pred.z += pred.vz * dt;
    } else {
      pred.x = -b.bx * 1.4; pred.y = -b.by * 1.4; pred.z = 0; pred.vx = pred.vy = pred.vz = 0;
    }

    for (let i = 0; i < N; i++) {
      const x = px[i], y = py[i], z = pz[i];
      const ix = Math.floor(x / cell), iy = Math.floor(y / cell), iz = Math.floor(z / cell);
      let sepX = 0, sepY = 0, sepZ = 0;
      let aliX = 0, aliY = 0, aliZ = 0;
      let cohX = 0, cohY = 0, cohZ = 0;
      let n = 0, cand = 0, links = 0, nk = 0;

      outer:
      for (let a = 0; a < 3; a++) for (let bb = 0; bb < 3; bb++) for (let cc = 0; cc < 3; cc++) {
        // Own cell first, so the candidate cap never skips the closest neighbours.
        const k = hash(ix + OFF[a], iy + OFF[bb], iz + OFF[cc]);
        let dup = false;
        for (let q = 0; q < nk; q++) if (seenKeys[q] === k) { dup = true; break; }
        if (dup) continue;
        seenKeys[nk++] = k;
        for (let s = cellStart[k], e = cellStart[k + 1]; s < e; s++) {
          const j = sorted[s];
          if (j === i) continue;
          if (++cand > CANDIDATE_CAP) break outer;
          const ox = px[j] - x, oy = py[j] - y, oz = pz[j] - z;
          const d2 = ox * ox + oy * oy + oz * oz;
          if (d2 < R2 && n < NEIGHBOUR_CAP) {
            n++;
            aliX += vx[j]; aliY += vy[j]; aliZ += vz[j];
            cohX += ox; cohY += oy; cohZ += oz;
            if (d2 < S2 && d2 > 0.0001) {
              const d = Math.sqrt(d2), f = (1 - d / S) / d;
              sepX -= ox * f; sepY -= oy * f; sepZ -= oz * f;
            }
          }
          if (j > i && d2 < LD2 && links < LINKS_PER_NODE && L < MAX_LINKS) {
            la[L] = i; lb[L] = j; ld[L] = Math.sqrt(d2) / LD; L++; links++;
            linked[i] = 1; linked[j] = 1;
          }
        }
      }

      let fx = 0, fy = 0, fz = 0;
      if (n > 0) {
        fx += (aliX / n - vx[i]) * wAli; fy += (aliY / n - vy[i]) * wAli; fz += (aliZ / n - vz[i]) * wAli;
        fx += cohX / n * wCoh;            fy += cohY / n * wCoh;            fz += cohZ / n * wCoh;
      }
      fx += sepX * wSep; fy += sepY * wSep; fz += sepZ * wSep;

      // Turbulence: a cheap swirling field so the flock keeps breaking up and re-forming.
      if (turb > 0) {
        const tt = t * 0.0004;
        fx += (Math.sin(y * 0.006 + tt) + Math.sin(z * 0.009 - tt * 1.3)) * turb;
        fy += (Math.sin(z * 0.007 + tt * 0.8) + Math.sin(x * 0.005 + tt * 1.1)) * turb;
        fz += (Math.sin(x * 0.008 - tt * 0.6) + Math.sin(y * 0.01 + tt * 0.9)) * turb * 0.6;
      }

      // Attractor
      if (att > 0) {
        const ox = ax - x, oy = ay - y, oz = az - z;
        // Pull grows with distance, so stray groups get reeled back into the main flock.
        const d = Math.hypot(ox, oy, oz) + 1, m = att * Math.min(2.5, d / 220) / d;
        fx += ox * m; fy += oy * m; fz += oz * m;
      }

      // Soft walls, so nothing ever leaves the screen for long.
      const turn = 0.12;
      if (x < -b.bx) fx += turn * Math.min(3, (-b.bx - x) / 40 + 1); else if (x > b.bx) fx -= turn * Math.min(3, (x - b.bx) / 40 + 1);
      if (y < -b.by) fy += turn * Math.min(3, (-b.by - y) / 40 + 1); else if (y > b.by) fy -= turn * Math.min(3, (y - b.by) / 40 + 1);
      if (z < -b.bz) fz += turn * Math.min(3, (-b.bz - z) / 40 + 1); else if (z > b.bz) fz -= turn * Math.min(3, (z - b.bz) / 40 + 1);

      // Predator
      if (pred.on) {
        const ox = x - pred.x, oy = y - pred.y, oz = z - pred.z;
        const d2 = ox * ox + oy * oy + oz * oz;
        if (d2 < fleeR2) {
          const d = Math.sqrt(d2) || 1, f = (1 - d / fleeR) * 1.4 / d;
          fx += ox * f; fy += oy * f; fz += oz * f;
        }
      }

      let nvx = vx[i] + fx * dt, nvy = vy[i] + fy * dt, nvz = vz[i] + fz * dt;
      const sp = Math.hypot(nvx, nvy, nvz) || 1;
      const k = sp > maxV ? maxV / sp : sp < minV ? minV / sp : 1;
      vx[i] = nvx * k; vy[i] = nvy * k; vz[i] = nvz * k;
    }

    for (let i = 0; i < N; i++) { px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt; }
  }

  // ---------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------
  const LINK_BUCKETS = 5;
  function project() {
    const cx = W / 2, cy = H / 2, r = P.size / 2;
    for (let i = 0; i < N; i++) {
      const s = FOCAL / (FOCAL + pz[i]);
      sx[i] = cx + px[i] * s; sy[i] = cy + py[i] * s; sr[i] = Math.max(0.5, r * s);
    }
  }

  function draw() {
    // Background, or a translucent wash for trails.
    const trail = P.trails;
    ctx.globalAlpha = 1;
    ctx.fillStyle = rgb(C.bg, trail > 0.005 ? 1 - trail : 1);
    ctx.fillRect(0, 0, W, H);

    project();

    // Links: dotted accent lines, like the homepage, bucketed by length so
    // longer links fade out without a stroke() call per line.
    if (L > 0 && P.linkA > 0.01) {
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = rgb(C.accent);
      for (let bkt = 0; bkt < LINK_BUCKETS; bkt++) {
        const lo = bkt / LINK_BUCKETS, hi = (bkt + 1) / LINK_BUCKETS;
        ctx.globalAlpha = P.linkA * (1 - lo) ;
        ctx.beginPath();
        for (let l = 0; l < L; l++) {
          const d = ld[l];
          if (d < lo || d >= hi) continue;
          ctx.moveTo(sx[la[l]], sy[la[l]]);
          ctx.lineTo(sx[lb[l]], sy[lb[l]]);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // Nodes: page-colour fill, accent ring if linked, hover-colour ring if not.
    ctx.lineWidth = 1;
    ctx.fillStyle = rgb(C.bg);
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = rgb(pass ? C.accent : C.hover);
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        if (linked[i] !== pass) continue;
        ctx.moveTo(sx[i] + sr[i], sy[i]);
        ctx.arc(sx[i], sy[i], sr[i], 0, Math.PI * 2);
      }
      if (P.size > 2.5) ctx.fill();
      ctx.stroke();
    }

    // Simulated IDs, capped using the original label-density calculation.
    const nl = Math.min(N, Math.round(P.labels * Math.min(N, 300)));
    if (nl > 0) {
      ctx.font = '600 9px monospace';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < nl; i++) {
        ctx.fillStyle = linked[i] ? rgb(C.fg, 0.75) : rgb(C.hover);
        ctx.fillText(ids[i], sx[i] + sr[i] + 5, sy[i]);
      }
    }

    // Predator
    if (pred.on) {
      const s = FOCAL / (FOCAL + pred.z);
      const x = W / 2 + pred.x * s, y = H / 2 + pred.y * s, r = Math.max(4, P.size * 0.9) * s;
      ctx.fillStyle = rgb(C.accent);
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = rgb(C.accent, 0.35);
      ctx.setLineDash([3, 5]);
      ctx.beginPath(); ctx.arc(x, y, (60 + P.pred * 220) * s, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Paused visual edits need fresh links without advancing any position,
  // velocity, predator state, or simulation time.
  function refreshLinks() {
    const distance = P.link, distance2 = distance * distance;
    cell = Math.max(P.vision, distance, 12);
    buildGrid();
    L = 0;
    linked.fill(0, 0, N);
    if (distance <= 0) return;
    for (let i = 0; i < N; i++) {
      const ix = Math.floor(px[i] / cell), iy = Math.floor(py[i] / cell), iz = Math.floor(pz[i] / cell);
      let candidates = 0, links = 0, keyCount = 0;
      outer:
      for (const ox of OFF) for (const oy of OFF) for (const oz of OFF) {
        const key = hash(ix + ox, iy + oy, iz + oz);
        let duplicate = false;
        for (let q = 0; q < keyCount; q++) if (seenKeys[q] === key) { duplicate = true; break; }
        if (duplicate) continue;
        seenKeys[keyCount++] = key;
        for (let s = cellStart[key]; s < cellStart[key + 1]; s++) {
          const j = sorted[s];
          if (j === i) continue;
          if (++candidates > CANDIDATE_CAP) break outer;
          const dx = px[j] - px[i], dy = py[j] - py[i], dz = pz[j] - pz[i];
          const d2 = dx * dx + dy * dy + dz * dz;
          if (j > i && d2 < distance2 && links < LINKS_PER_NODE && L < MAX_LINKS) {
            la[L] = i; lb[L] = j; ld[L] = Math.sqrt(d2) / distance;
            L++; links++;
            linked[i] = 1; linked[j] = 1;
          }
        }
      }
    }
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
      setCount(P.count);
      dirty = true;
    }
  }

  function render() {
    draw();
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
        step(1, simTime);
      }
      accumulator = Math.max(0, accumulator - STEP_MS);
      steps++;
    }
    if (!paused || dirty) {
      if (paused) refreshLinks();
      render();
    }
    if (now - statsTime >= 500) {
      fps = Math.round(statsFrames * 1000 / (now - statsTime));
      onStats({ count: N, fps, paused });
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
    setCount(P.count);
    gather();
    Object.assign(pred, { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, on: false });
    simTime = 0;
    accumulator = 0;
    last = performance.now();
    refreshLinks();
    dirty = true;
  }

  function scatter() {
    if (destroyed) return;
    scatterFlock();
    refreshLinks();
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
    mouse.x = x; mouse.y = y; mouse.down = Boolean(down);
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
    window.removeEventListener('resize', resize);
    document.removeEventListener('visibilitychange', visibilityChanged);
    mouse.down = false;
  }

  function getState() {
    const positions = Array.from({ length: N }, (_, i) => [px[i], py[i], pz[i]]);
    const velocities = Array.from({ length: N }, (_, i) => [vx[i], vy[i], vz[i]]);
    const finite = positions.every(point => point.every(Number.isFinite)) &&
      velocities.every(vector => vector.every(Number.isFinite)) && Number.isFinite(simTime);
    return {
      count: N, paused, frames, simTime, finite, positions, velocities,
      values: target.slice(), parameters: { ...P }, links: L, fps,
      width: W, height: H, destroyed,
    };
  }

  updateColours();
  resize();
  setCount(P.count);
  gather();
  refreshLinks();
  if (!document.hidden) render();
  onStats({ count: N, fps: 0, paused });
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', visibilityChanged);
  schedule();

  return {
    setParameter, setParameters, reset, scatter, setPaused, setPointer,
    resize, destroy, getState,
  };
}
