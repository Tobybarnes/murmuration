# Bird rendering branch

Branch: `feature/realistic-birds`. Based on the live dot visualizer at `bb0cf87`.

The first implementation is complete. Birds now have tapered wings, a body and tail, individual wingbeats, gliding intervals, banking and perspective. The Birds / Dots switch changes appearance while the flock keeps moving. Connections and labels are optional. The view opens against a light sky and respects saved settings and reduced motion.

Movement lives in `src/scenes/sky.js`; `src/renderers/canvas.js` reads its cached frame; `src/renderers/birds.js` draws the shared flying, gliding, landing, perched and takeoff poses. The existing host still owns fixed ticks, pause, visibility and cleanup. Input snapshots preserve canonical IDs and surviving positions, accept empty and single-item flocks, and deduplicate activity events. Fresh weather adds bounded wind, and listening adds a small speed change.

`npm run check`, `npm test` and `npm run build` pass. Tests compare seeded positions and velocities with the original engine at frames 0, 60 and 120, and cover identity, empty snapshots, event replay, finite geometry and paused wingbeats. The performance targets below still need measurements on representative desktop and phone hardware. Species-specific anatomy and feather detail remain future work.

## Original implementation brief

Make the existing flock look like birds while preserving the movement that already works. The first deliverable is a switch between the current dots and small directional silhouettes in the sky scene. Keep Ben Bashford’s attribution and the existing separation, alignment, cohesion, spatial hash, fixed timestep, pause and behaviour when the tab is hidden.

Start by extracting drawing from `src/simulation.js`. The module currently owns movement and drawing, and its diagnostic `getState()` copies every position and velocity. Add a rendering boundary that reads the active simulation buffers without copying the whole flock each frame. Keep the current dot renderer available as a visual and performance reference.

This branch owns the proposed `src/scene-contract.js`, `src/renderers/canvas.js`, `src/renderers/birds.js` and `src/scenes/sky.js`, plus the small extraction from `simulation.js`. Agree and share that contract before the wire branch integrates. The host keeps its animation clock, parameter smoothing, pause, resize, visibility and cleanup. A scene strategy exposes `sync(items, changes)`, `update(dtMs, simTime)`, `getFrame()`, `setEnvironment(environment)`, `resize(viewport)` and `dispose()`. Its frame supplies `birdId`, position, velocity, pose, wing phase and optional scene geometry; the renderer draws those values without changing item state.

The inputs branch owns canonical item identities and lifecycle changes. Keep a separate mapping from stable `birdId` to the engine’s numeric array slot. Reordering a snapshot, removing another bird or switching scenes must preserve that identity. For real inputs, `birdId` is the canonical `itemId`. Until inputs lands, use explicit fixture IDs. Weather and listening state arrive through `setEnvironment(environment)` with freshness information; they can alter bounded scene behaviour without creating item birds. The wire branch supplies its own movement and perch strategy through this contract, and requests shared pose additions from the birds branch.

Develop the visuals in three stages:

1. Draw a body and two wings, orient them from velocity, and give each bird a consistent wing phase offset derived from its ID. Preserve the last valid heading when speed approaches zero. Check silhouettes at their actual viewing size.
2. Add banking, gliding, depth and varied wingbeats. Keep appearance separate from steering; changes to sky movement should be deliberate and reviewed against the original flock.
3. Add reusable landing, perched and takeoff poses for the wire scene. The wire strategy decides when each transition starts and where the bird moves; this renderer supplies the body, wings, feet and tail poses.

Acceptance includes unchanged seeded dot trajectories after extraction, finite geometry, stable IDs through scene switches, frozen wing motion while paused, and a readable reduced-motion view. Inspect flight direction, turns and overlapping birds in desktop and touch layouts. Proposed, unverified targets are 60 fps for 1,000 simple birds on the chosen desktop and 30 fps for 300 on the chosen phone over two minutes. Record the exact devices, browsers and frame-time results before claiming those targets are met.

Related work: [inputs](https://github.com/Tobybarnes/murmuration/tree/feature/inputs) and [wires](https://github.com/Tobybarnes/murmuration/tree/feature/wires). Agree the scene contract first and keep its extraction in a separate commit so the wire work can build on it.
