# Telephone wire scene

Branch: `feature/wires`.

The branch now opens a daylight scene with three wires: Email, Agents and Other. Each bird represents one sample item. Existing items begin perched; new items approach, brake and land. Reading an email softens its silhouette, an agent reply stirs its bird, and archiving an item makes its bird take off. The controls include a short recorded sequence and a reset. No accounts are connected.

The Sky switch uses the same selected items and Ben Bashford’s flocking engine, extracted into the shared sky strategy. It preserves canonical item IDs. The original large flock and its controls remain available at `/classic.html`. Both scenes use the shared procedural bird renderer and retain Ben’s attribution.

## Scene and item boundaries

`src/scenes/wires.js` implements `sync(items, changes)`, `update(dtMs, simTime)`, `getFrame()`, `setEnvironment(environment)`, `resize(viewport)` and `dispose()`. The frame, bird views, counts and wire geometry are reused. The host owns the fixed clock, pause, visibility, resizing and cleanup. Weather uses `windKph`, `windDirection`, `observedAt` and `expiresAt`; fresh wind shifts wire geometry and feet together. Ambient state never creates item birds.

Perch reservations are keyed by canonical `itemId`. Reordering snapshots or adding and removing unrelated items does not move existing reservations. A departing bird releases its slot once clear of the wire. Resizing preserves slots that still fit and admits waiting items when space becomes available. An animation never changes the sample item’s read or archive state.

The fixture store rejects duplicate deliveries and stale revisions, including delayed updates after removal. Activity responses ignore expired or repeated events. This store is a local sample source; private provider reconciliation belongs to the inputs branch.

## Capacity and accessibility

Wires keep at least 47 CSS pixels between slots. At a 390-pixel width, each wire holds six items; at 320 pixels it holds four. The scene shows total and displayed counts, plus the number waiting for space. Sky mode can show more of the same items because it does not require perches.

Pause freezes simulation time. Hidden tabs stop scheduling frames and resume without replaying the hidden interval. Reduced-motion preferences start the scene paused and apply arrivals and removals at rest. Item selection, mark read, archive and scene switching are available through native controls. Short screens scroll through a full composition so the wires and controls remain separate.

## Verification

Run `npm run check`, `npm test` and `npm run build`.

The wire tests cover reservation stability, overflow, reappearance during departure, phone resizing, landing contact, braking, departure during landing, heading direction, weather expiry, reduced motion, stable IDs between scenes, duplicate and stale deliveries, reset/replay, pause, tab visibility and resource cleanup. The shared tests verify bird geometry and parity with the original flock simulation.

Desktop and 390 × 844 browser checks exercised new email, reading, archive, selection, pause and scene switching. No device-specific frame-rate target has been measured. This is an interactive sample ready for the inputs branch’s normalized data; it does not read or change real email, documents or conversations.

Related branches: [bird rendering](https://github.com/Tobybarnes/murmuration/tree/feature/realistic-birds) and [inputs](https://github.com/Tobybarnes/murmuration/tree/feature/inputs).
