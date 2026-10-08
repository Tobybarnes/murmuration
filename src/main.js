import { PARAMS } from './parameters.js';
import { createSimulation } from './simulation.js';
import { FADERS_KEY, writeJSON, readFaders } from './storage.js';

const $ = (id) => document.getElementById(id);
const canvas = $('flock');
const defaults = PARAMS.map(p => p.def);
let values = readFaders(defaults);
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
  label.htmlFor = input.id; label.textContent = parameter.label;
  const output = document.createElement('output');
  output.htmlFor = input.id;
  output.setAttribute('aria-hidden', 'true');
  input.addEventListener('input', () => setParameter(index, Number(input.value) / 1000));
  input.addEventListener('dblclick', () => setParameter(index, parameter.def));
  fader.append(number, input, label, output);
  $('faders').append(fader);
  return { input, output };
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
  const foreground = [palette.fg, 'rgb(238,229,210)', 'rgb(53,67,51)', 'rgb(250,246,231)', 'rgb(21,28,22)', 'rgb(255,254,248)', 'rgb(2,4,2)']
    .find(color => contrast(color) >= 4.5);
  const a = foreground.match(/\d+/g).map(Number);
  const b = palette.bg.match(/\d+/g).map(Number);
  const secondary = `rgb(${a.map((value, index) => Math.round(value * .72 + b[index] * .28)).join(',')})`;
  return { ...palette, panel: palette.bg, fg: foreground, muted: contrast(secondary) >= 4.5 ? secondary : foreground,
    accent: contrast(palette.accent) >= 4.5 ? palette.accent : foreground };
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
    values, paused,
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
if (paused) notice('Motion is paused to match your device settings. Resume when you’re ready.');
reducedMotion.addEventListener('change', event => { if (event.matches) setPaused(true); });

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
