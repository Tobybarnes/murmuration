import { createSkyScene } from './sky.js';
import { PARAMS } from '../parameters.js';
import { laneFor, LANES } from './perches.js';

// The same flock engine as the large sky study, placed in the space between
// the title and sample controls. This adapter never changes item membership.
export function createWireSky({ width = 1200, height = 800 } = {}) {
  const values = PARAMS.map(parameter => parameter.def);
  values[0] = 0; values[1] = .17; values[9] = .63;
  const bounds = () => ({ width, height: Math.max(150, height - (width < 640 ? 480 : 410)) });
  const sky = createSkyScene({ ...bounds(), values });
  const frame = { birds: [], geometry: [], width, height, time: 0,
    counts: Object.fromEntries(LANES.map(lane => [lane, { total: 0, visible: 0, overflow: 0 }])) };
  const metadata = new Map(), views = new Map();
  let reducedMotion = false, disposed = false, motionTime = 0;
  sky.sync([]);
  function place() {
    frame.birds.length = 0;
    for (const lane of LANES) frame.counts[lane].visible = 0;
    for (const bird of sky.getFrame().birds) {
      let view = views.get(bird.birdId);
      if (!view) { view = {}; views.set(bird.birdId, view); }
      Object.assign(view, bird);
      view.y += width < 640 ? 185 : 175;
      view.category = metadata.get(bird.birdId);
      view.activity = reducedMotion ? 0 : view.activity;
      frame.birds.push(view);
      frame.counts[view.category].visible++;
    }
    for (const lane of LANES) frame.counts[lane].overflow = frame.counts[lane].total - frame.counts[lane].visible;
  }
  return {
    sync(items, changes = []) {
      if (disposed) return;
      sky.sync(items, changes);
      metadata.clear();
      for (const lane of LANES) frame.counts[lane].total = 0;
      for (const item of items) { const lane = laneFor(item); metadata.set(item.itemId, lane); frame.counts[lane].total++; }
      for (const id of views.keys()) if (!metadata.has(id)) views.delete(id);
      place();
    },
    update(dtMs, simTime = frame.time + dtMs) {
      if (disposed) return;
      frame.time = simTime;
      if (!reducedMotion) motionTime += dtMs;
      sky.update(reducedMotion ? 0 : dtMs, motionTime);
      place();
    },
    getFrame: () => frame,
    resize(viewport) {
      if (disposed) return;
      width = viewport.width; height = viewport.height;
      frame.width = width; frame.height = height;
      sky.resize(bounds()); place();
    },
    setEnvironment(environment = {}) {
      if (disposed) return;
      reducedMotion = environment.reducedMotion ?? reducedMotion;
      sky.setEnvironment(environment); place();
    },
    dispose() { disposed = true; sky.dispose(); metadata.clear(); views.clear(); frame.birds.length = 0; },
  };
}
