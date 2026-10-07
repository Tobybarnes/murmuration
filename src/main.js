import { PARAMS } from './parameters.js';
import { createSimulation } from './simulation.js';
import { FADERS_KEY, writeJSON, readFaders, readJSON } from './storage.js';

const $ = (id) => document.getElementById(id);
const canvas = $('flock');
const defaults = PARAMS.map(p => p.def);
// The bird study opens against a light sky; saved flock controls still win.
const openingValues = [...defaults];
openingValues[15] = 1;
let values = readFaders(openingValues);
const APPEARANCE_KEY = 'murmuration.v1.appearance';
let appearance = readJSON(APPEARANCE_KEY, 'birds') === 'dots' ? 'dots' : 'birds';
let overlays = appearance === 'dots';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let paused = reducedMotion.matches;
let sim;
let noticeTimer;
const controls = PARAMS.map((parameter, index) => {
  const fader = document.createElement('div');
  fader.className = 'fader';
  const number = document.createElement('span');
  number.className = 'fader-index';
  number.textContent = String(index + 1).padStart(2, '0');
  number.setAttribute('aria-hidden', 'true');
  const input = document.createElement('input');
  input.type = 'range'; input.min = '0'; input.max = '1000'; input.step = '1';
  input.id = `fader-${parameter.key}`;
  input.setAttribute('aria-orientation', 'vertical');
  const label = document.createElement('label');
  label.htmlFor = input.id;
  label.textContent = parameter.key === 'count' ? 'Flock' : parameter.key === 'size' ? 'Bird size' : parameter.label;
  const output = document.createElement('output');
  output.htmlFor = input.id;
  output.setAttribute('aria-hidden', 'true');
  input.addEventListener('input', () => setParameter(index, Number(input.value) / 1000));
  input.addEventListener('dblclick', () => setParameter(index, parameter.def));
  fader.append(number, input, label, output);
  $('faders').append(fader);
  return { input, output, label };
});

function luminance(color) {
  const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
    const channel = value / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  });
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}
function readablePalette(palette) {
  const background = luminance(palette.bg);
  const contrast = color => {
    const foreground = luminance(color);
    return (Math.max(background, foreground) + .05) / (Math.min(background, foreground) + .05);
  };
  const foreground = [palette.fg, 'rgb(235,242,250)', 'rgb(26,26,26)', 'rgb(255,255,254)', 'rgb(3,4,3)']
    .find(color => contrast(color) >= 4.5);
  const a = foreground.match(/\d+/g).map(Number);
  const b = palette.bg.match(/\d+/g).map(Number);
  const secondary = `rgb(${a.map((value, index) => Math.round(value * .72 + b[index] * .28)).join(',')})`;
  return { ...palette, fg: foreground, muted: contrast(secondary) >= 4.5 ? secondary : foreground,
    accent: contrast(palette.accent) >= 3 ? palette.accent : foreground };
}

function syncControls() {
  PARAMS.forEach((parameter, index) => {
    const v = values[index];
    const resolved = parameter.min + (parameter.max - parameter.min) * (parameter.curve ? v ** parameter.curve : v);
    const formatted = String(parameter.fmt(resolved));
    controls[index].input.value = String(Math.round(v * 1000));
    controls[index].input.setAttribute('aria-valuetext', formatted);
    controls[index].output.textContent = formatted;
  });
}
function setParameter(index, value) {
  sim?.setParameter(index, value);
  values[index] = value;
  syncControls();
  writeJSON(FADERS_KEY, values);
}
function notice(message) {
  clearTimeout(noticeTimer);
  $('notice').textContent = message;
  $('notice').classList.add('visible');
  noticeTimer = setTimeout(() => $('notice').classList.remove('visible'), 3500);
}
function setPaused(next) {
  paused = next;
  sim?.setPaused(paused);
  $('pause').textContent = paused ? 'Resume' : 'Pause';
  $('pause').setAttribute('aria-pressed', String(paused));
  $('pause').title = `${paused ? 'Resume' : 'Pause'} animation (Space)`;
  $('play-state').textContent = paused ? 'At rest' : 'In flight';
  document.body.classList.toggle('paused', paused);
}
function setAppearance(next) {
  appearance = next;
  overlays = appearance === 'dots';
  sim?.setAppearance(appearance);
  writeJSON(APPEARANCE_KEY, appearance);
  syncAppearance();
}
function syncAppearance() {
  document.body.dataset.appearance = appearance;
  canvas.dataset.appearance = appearance;
  canvas.setAttribute('aria-label', `Animated flock of simulated ${appearance === 'birds' ? 'birds' : 'dots'}. Hold a pointer on the canvas to attract them.`);
  $('view-birds').setAttribute('aria-pressed', String(appearance === 'birds'));
  $('view-dots').setAttribute('aria-pressed', String(appearance === 'dots'));
  $('study-note').textContent = appearance === 'birds' ? 'Wingbeats, glides and turns in open sky.' : 'The original flock, drawn as connected dots.';
  $('overlays').setAttribute('aria-pressed', String(overlays));
  $('overlays').textContent = overlays ? 'Connections on' : 'Connections off';
  controls[9].label.textContent = appearance === 'birds' ? 'Bird size' : 'Dot size';
}
function toggleSettings(open = $('settings').hidden) {
  $('settings').hidden = !open;
  $('settings-toggle').setAttribute('aria-expanded', String(open));
  $('settings-toggle').innerHTML = `Tune flock <span aria-hidden="true">${open ? '−' : '+'}</span>`;
}
function hideInterface(hidden) {
  document.body.classList.toggle('interface-hidden', hidden);
  document.querySelectorAll('.interface').forEach(el => { el.inert = hidden; });
  $('show').hidden = !hidden;
  if (hidden) $('show').focus(); else $('hide').focus();
}
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    else notice('Fullscreen is unavailable in this browser.');
  } catch { notice('This browser could not enter fullscreen.'); }
}
function reset() {
  values = [...defaults];
  sim?.reset();
  syncControls();
  writeJSON(FADERS_KEY, values);
  notice('Original flock settings restored.');
}

syncControls();
try {
  sim = createSimulation(canvas, {
    values, paused, appearance,
    onStats({ count, fps }) {
      $('count').textContent = count.toLocaleString('en-US');
      $('fps').textContent = `${Math.round(fps)} fps`;
      canvas.dataset.birdCount = String(count);
      canvas.dataset.paused = String(paused);
    },
    onPalette(palette) {
      // The canvas keeps Ben's colour interpolation. UI text stays readable
      // through the midpoint, where the source foreground/background converge.
      for (const [key, value] of Object.entries(readablePalette(palette))) document.documentElement.style.setProperty(`--${key}`, value);
      const theme = values[15];
      document.documentElement.style.colorScheme = theme > .5 ? 'light' : 'dark';
      document.querySelector('meta[name="theme-color"]').content = palette.bg;
    },
  });
} catch (error) {
  $('error').hidden = false;
  $('error').textContent = 'The flock could not start. Your browser needs Canvas 2D support. Try reloading or opening this page in another browser.';
  document.querySelectorAll('button,input').forEach(el => { el.disabled = true; });
  console.error(error);
}
setPaused(paused);
syncAppearance();
if (paused) notice('Motion is paused to match your device settings. Resume when you’re ready.');
reducedMotion.addEventListener('change', event => { if (event.matches) setPaused(true); });

$('view-birds').addEventListener('click', () => setAppearance('birds'));
$('view-dots').addEventListener('click', () => setAppearance('dots'));
$('overlays').addEventListener('click', () => {
  overlays = !overlays;
  sim?.setOverlays(overlays);
  syncAppearance();
});
$('pause').addEventListener('click', () => setPaused(!paused));
$('scatter').addEventListener('click', () => { sim?.scatter(); notice('Flock scattered.'); });
$('reset').addEventListener('click', reset);
$('settings-toggle').addEventListener('click', () => toggleSettings());
$('settings-close').addEventListener('click', () => { toggleSettings(false); $('settings-toggle').focus(); });
$('hide').addEventListener('click', () => hideInterface(true));
$('show').addEventListener('click', () => hideInterface(false));
$('fullscreen').addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', () => $('fullscreen').setAttribute('aria-label', document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen'));
window.addEventListener('keydown', event => {
  if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
  if (event.key === 'Escape' && !$('settings').hidden) {
    toggleSettings(false); $('settings-toggle').focus(); return;
  }
  if (event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
  if (event.key === ' ' && event.target.closest('button,a')) return;
  const key = event.key.toLowerCase();
  if (key === ' ') { event.preventDefault(); setPaused(!paused); }
  else if (key === 's') sim?.scatter();
  else if (key === 'r') reset();
  else if (key === 'h') hideInterface(!document.body.classList.contains('interface-hidden'));
  else if (key === 'f') toggleFullscreen();
});
let pointerDown = false;
canvas.addEventListener('pointerdown', event => {
  pointerDown = true;
  canvas.setPointerCapture(event.pointerId);
  sim?.setPointer(event.clientX, event.clientY, true);
});
canvas.addEventListener('pointermove', event => {
  if (pointerDown) sim?.setPointer(event.clientX, event.clientY, true);
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, event => {
  pointerDown = false; sim?.setPointer(event.clientX || 0, event.clientY || 0, false);
});
window.addEventListener('blur', () => { pointerDown = false; sim?.setPointer(0, 0, false); });
