import { createWireScene } from './scenes/wires.js';
import { createWireSky } from './scenes/wire-sky.js';
import { drawBird } from './renderers/birds.js';
import { drawPigeon } from './renderers/pigeons.js';
import { drawSky } from './renderers/sky.js';
import { createSampleStore, sampleMinute } from './fixtures/wires.js';
import { LANES } from './scenes/perches.js';

const $ = id => document.getElementById(id);
const canvas = $('wires');
const ctx = canvas.getContext('2d');
const STEP = 1000 / 60;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const listeners = new AbortController();
const listen = (target, type, fn) => target.addEventListener(type, fn, { signal: listeners.signal });
let store, scenes, selectedId, active = 'wires', viewport, skyPhoto;
let paused = reducedMotion.matches, disposed = false, frameId = null;
let simTime = 0, skyTime = 0, last = performance.now(), accumulator = 0, serial = 0, arrival = 0;
let replay = null, replayItem = null, noticeUntil = 0;

function notice(text) { $('notice').textContent = text; noticeUntil = simTime + 5400; }
function requestDraw() { if (!disposed && !document.hidden && frameId === null) frameId = requestAnimationFrame(tick); }
function stopReplay() { replay = null; $('replay').textContent = 'Play sequence'; }
function createScenes() {
  Object.values(scenes || {}).forEach(scene => scene.dispose());
  scenes = { wires: createWireScene({ ...viewport, reducedMotion: reducedMotion.matches }), sky: createWireSky(viewport) };
  for (const scene of Object.values(scenes)) {
    scene.setEnvironment({ reducedMotion: reducedMotion.matches });
    scene.update(0, simTime);
    scene.sync(store.items());
  }
}
function resetSample(announce = true) {
  stopReplay(); store = createSampleStore(); arrival = 0;
  selectedId = store.items()[0].itemId;
  createScenes(); updateItems(); requestDraw();
  if (announce) notice('The sample inbox is back where it started.');
}
function apply(event) {
  const changes = store.apply(event);
  if (!changes.length) return;
  for (const scene of Object.values(scenes)) scene.sync(store.items(), changes);
  updateItems(); requestDraw();
}
function event(type, itemId, item) {
  return { eventId: `sample-event-${++serial}`, type, itemId, item,
    revision: (store.get(itemId)?.revision || 0) + 1, occurredAt: Date.now(), expiresAt: Date.now() + 60_000 };
}
function addItem(category = 'email', announce = true) {
  const itemId = `sample:${category}:arrival-${++arrival}`;
  const item = { itemId, sourceId: String(arrival), source: 'sample', accountId: 'demo', category,
    title: category === 'email' ? `A new email · ${arrival}` : `A fresh document · ${arrival}`,
    readState: category === 'email' ? 'unread' : 'unknown', revision: 1, updatedAt: Date.now() };
  selectedId = itemId; apply(event('upsert', itemId, item));
  if (announce) {
    const isVisible = scenes[active].getFrame().birds.some(bird => bird.birdId === itemId);
    notice(!isVisible ? 'Added to the sample inbox. This wire is full at this window size.' : paused && !reducedMotion.matches ? 'Added to the sample inbox. Resume to watch the arrival.' : active === 'sky' ? 'A new bird is joining the flock.' : category === 'email' ? 'A new email is finding its place.' : 'A document is joining the Other wire.');
  }
  return itemId;
}
function markRead(itemId = selectedId, announce = true) {
  const item = store.get(itemId);
  if (!item || item.category !== 'email' || item.readState === 'read') return;
  apply(event('upsert', itemId, { ...item, readState: 'read' }));
  if (announce) notice('Read. The bird stays; its silhouette softens.');
}
function archive(itemId = selectedId, announce = true) {
  if (!store.get(itemId)) return;
  apply(event('remove', itemId));
  if (announce) notice('Archived from the sample inbox. Its bird is leaving.');
}
function reply(announce = true) {
  const item = store.get(selectedId)?.category === 'agents' ? store.get(selectedId) : store.items().find(candidate => candidate.category === 'agents');
  if (!item) { if (announce) notice('Reset the sample to bring the agent conversations back.'); return; }
  selectedId = item.itemId; apply(event('activity', item.itemId));
  if (announce) notice('An agent replied. Its existing bird stirs.');
}
function updateItems() {
  const items = store.items();
  if (!store.get(selectedId)) selectedId = items[0]?.itemId || '';
  const select = $('selected-item');
  select.replaceChildren(...items.map(item => {
    const option = document.createElement('option'); option.value = item.itemId; option.textContent = item.title; return option;
  }));
  if (!items.length) { const option = document.createElement('option'); option.textContent = 'The wires are empty'; select.append(option); }
  select.value = selectedId; select.disabled = !items.length;
  updateSelection();
}
function updateSelection() {
  const item = store.get(selectedId);
  $('read').disabled = !item || item.category !== 'email' || item.readState === 'read';
  $('archive').disabled = !item;
  $('selected-state').textContent = !item ? 'Add an email to begin' : item.readState === 'unread' ? 'Unread email' : item.readState === 'read' ? 'Read email' : 'Read state unknown';
  requestDraw();
}
function setPaused(value) {
  paused = value; last = performance.now(); accumulator = 0;
  $('pause').textContent = paused ? 'Resume' : 'Pause'; $('pause').setAttribute('aria-pressed', String(paused));
  requestDraw();
}
function switchScene(next) {
  active = next;
  $('scene-wires').setAttribute('aria-pressed', String(next === 'wires'));
  $('scene-sky').setAttribute('aria-pressed', String(next === 'sky'));
  $('scene-caption').textContent = next === 'wires' ? 'Email, agents, and everything else.' : 'The same conversations, in flight.';
  $('scene-detail').textContent = next === 'wires' ? 'Each bird keeps its own place.' : 'A pigeon flock circling the city.';
  requestDraw();
}
function resize() {
  const rect = canvas.getBoundingClientRect();
  viewport = { width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(viewport.width * dpr); canvas.height = Math.round(viewport.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  Object.values(scenes || {}).forEach(scene => scene.resize(viewport));
  requestDraw();
}
function draw() {
  const { width: w, height: h } = viewport;
  drawSky(ctx, skyPhoto, w, h, skyTime);
  const frame = scenes[active].getFrame();
  for (const wire of frame.geometry) {
    ctx.strokeStyle = '#26392ebf'; ctx.lineWidth = 1.15;
    ctx.beginPath(); ctx.moveTo(wire.x1, wire.y1);
    ctx.quadraticCurveTo((wire.x1 + wire.x2) / 2, (wire.y1 + wire.y2) / 2 + wire.sag * 2, wire.x2, wire.y2); ctx.stroke();
    ctx.fillStyle = '#26392e'; ctx.font = `500 ${w < 640 ? 8 : 9}px "Avenir Next", Avenir, sans-serif`;
    ctx.shadowColor = '#faf6e7'; ctx.shadowBlur = 5;
    ctx.fillText(wire.lane.toUpperCase(), w < 640 ? 22 : 40, wire.y1 - 13);
    ctx.shadowBlur = 0;
  }
  for (const bird of frame.birds) {
    if (bird.birdId === selectedId && !bird.departing) {
      ctx.strokeStyle = '#845f4163'; ctx.lineWidth = .8; ctx.beginPath();
      ctx.arc(bird.x, bird.y - (bird.pose === 'perched' ? bird.size * .7 : 0), bird.size * 1.55, 0, Math.PI * 2); ctx.stroke();
    }
    // Perched coordinates are feet; flight coordinates are body centres.
    const renderer = active === 'sky' ? drawPigeon : drawBird;
    renderer(ctx, bird, { colour: '#26392e', alpha: active === 'sky' ? (bird.readState === 'read' ? .60 : .95) * bird.alpha : bird.readState === 'read' ? .52 : .92 });
  }
  const total = store.items().length;
  const visible = Object.values(frame.counts).reduce((sum, counts) => sum + counts.visible, 0);
  const overflow = total - visible;
  $('summary').textContent = `${visible} ${active === 'wires' ? 'on the wires' : 'in flight'} · ${total} sample items`;
  for (const lane of LANES) $('count-' + lane).textContent = frame.counts[lane].total;
  $('overflow').hidden = overflow <= 0;
  $('overflow').textContent = `${overflow} waiting for a perch at this window size`;
  $('play-state').textContent = paused ? 'Motion paused' : replay ? 'Playing a sample sequence' : 'Watching for activity';
  canvas.dataset.birdCount = String(total); canvas.dataset.visibleCount = String(visible);
  canvas.dataset.selectedId = selectedId; canvas.dataset.scene = active; canvas.dataset.paused = String(paused);
  canvas.dataset.simTime = String(Math.round(simTime));
  canvas.dataset.birdIds = frame.birds.filter(bird => !bird.departing).map(bird => bird.birdId).join(',');
  canvas.setAttribute('aria-label', `${active === 'wires' ? 'Telephone wire' : 'Sky'} scene. ${visible} birds represent ${total} sample items. ${overflow > 0 ? `${overflow} items are waiting for a visible perch.` : ''} Select an item below to find its bird.`);
}
function playStep(step) {
  if (step.action === 'arrival') replayItem = addItem('email', false);
  else if (step.action === 'read') markRead(replayItem, false);
  else if (step.action === 'reply') reply(false);
  else if (step.action === 'archive') archive(replayItem, false);
  else if (step.action === 'document') addItem('other', false);
  notice(step.text);
}
function tick(now) {
  frameId = null;
  if (disposed || document.hidden) return;
  if (!paused) {
    accumulator += Math.min(50, Math.max(0, now - last));
    while (accumulator >= STEP - .00001) {
      simTime += STEP; accumulator -= STEP;
      if (!reducedMotion.matches) skyTime += STEP;
      if (replay) {
        while (replay.steps.length && simTime - replay.started >= replay.steps[0].at) playStep(replay.steps.shift());
        if (!replay.steps.length) stopReplay();
      }
      for (const scene of Object.values(scenes)) scene.update(STEP, simTime);
    }
  }
  last = now;
  if (noticeUntil && simTime > noticeUntil) { $('notice').textContent = ''; noticeUntil = 0; }
  draw();
  if (!paused) requestDraw();
}
function suspend() { if (frameId !== null) cancelAnimationFrame(frameId); frameId = null; accumulator = 0; }
function dispose() { disposed = true; suspend(); listeners.abort(); skyPhoto.onload = null; Object.values(scenes).forEach(scene => scene.dispose()); }

try {
  if (!ctx) throw new Error('Canvas 2D unavailable');
  skyPhoto = new Image(); skyPhoto.onload = requestDraw; skyPhoto.src = '/sky-photo.png';
  resize(); resetSample(false); setPaused(paused);
  if (reducedMotion.matches) notice('Motion is paused to match your device settings. Sample changes appear at rest.');
  listen($('scene-wires'), 'click', () => switchScene('wires'));
  listen($('scene-sky'), 'click', () => switchScene('sky'));
  listen($('pause'), 'click', () => setPaused(!paused));
  listen($('new-email'), 'click', () => { stopReplay(); addItem(); });
  listen($('agent-reply'), 'click', () => { stopReplay(); reply(); });
  listen($('read'), 'click', () => { stopReplay(); markRead(); });
  listen($('archive'), 'click', () => { stopReplay(); archive(); });
  listen($('reset'), 'click', () => resetSample());
  listen($('replay'), 'click', () => {
    if (replay) { stopReplay(); requestDraw(); return; }
    resetSample(false); replay = { started: simTime, steps: sampleMinute.map(step => ({ ...step })) };
    $('replay').textContent = 'Stop sequence'; setPaused(false);
  });
  listen($('selected-item'), 'change', event => { selectedId = event.target.value; updateSelection(); });
  document.querySelectorAll('[data-lane]').forEach(button => listen(button, 'click', () => {
    const item = store.items().find(candidate => candidate.category === button.dataset.lane);
    if (item) { selectedId = item.itemId; $('selected-item').value = selectedId; updateSelection(); }
  }));
  listen(canvas, 'pointerup', event => {
    const rect = canvas.getBoundingClientRect();
    const hit = scenes[active].getFrame().birds.filter(bird => !bird.departing).map(bird => ({
      bird, distance: Math.hypot(event.clientX - rect.left - bird.x, event.clientY - rect.top - bird.y + (bird.pose === 'perched' ? bird.size * .7 : 0)),
    })).filter(candidate => candidate.distance < 25).sort((a, b) => a.distance - b.distance)[0];
    if (hit) { selectedId = hit.bird.birdId; $('selected-item').value = selectedId; updateSelection(); }
  });
  listen(window, 'resize', resize);
  listen(window, 'keydown', event => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.target.closest('button,a,select,input,textarea')) return;
    if (event.key === ' ') { event.preventDefault(); setPaused(!paused); }
  });
  listen(document, 'visibilitychange', () => { suspend(); last = performance.now(); if (!document.hidden) requestDraw(); });
  listen(reducedMotion, 'change', event => {
    for (const scene of Object.values(scenes)) scene.setEnvironment({ reducedMotion: event.matches });
    if (event.matches) setPaused(true); else requestDraw();
  });
  listen(window, 'pagehide', event => { if (event.persisted) suspend(); else dispose(); });
  listen(window, 'pageshow', () => { last = performance.now(); requestDraw(); });
} catch (error) {
  suspend(); $('error').hidden = false;
  $('error').textContent = 'The scene could not start. Try reloading or opening this page in a browser with Canvas 2D support.';
  document.querySelectorAll('button,select').forEach(control => { control.disabled = true; });
  console.error(error);
}
