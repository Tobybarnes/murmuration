# Telephone wire scene branch

Branch: `feature/wires`. Based on the live dot visualizer at `bb0cf87`. This brief describes planned work; creating the branch does not implement it.

Build three telephone wires for Email, Agents and Other, with one visible bird for each selected item. The first deliverable uses a recorded fixture to show an arrival, a settled bird, an activity change and a departure. A new email should approach its wire and land without making the birds already there shuffle along. Preserve Ben Bashford’s attribution and the existing sky experiment.

Use the scene contract and Canvas renderer owned by the birds branch. The proposed strategy methods are `sync(items, changes)`, `update(dtMs, simTime)`, `getFrame()`, `setEnvironment(environment)`, `resize(viewport)` and `dispose()`. Frames carry stable `birdId`, position, velocity, pose, wing phase and scene geometry. The host continues to own the fixed clock, pause, resize, visibility, palette and cleanup. This branch owns proposed `src/scenes/wires.js`, `src/scenes/perches.js`, wire fixtures and their tests. It supplies wire geometry and movement; shared bird drawing and poses remain with the birds branch.

The inputs branch owns item IDs, categories, read state, deletion records and provider reconciliation. Consume its normalized items and changes, using canonical `itemId` as `birdId`. Weather and listening state arrive through `setEnvironment(environment)` with freshness information. They can affect sky colour, subtle wire movement and resting behaviour without creating birds or changing item state. Keep perch reservations keyed by `birdId`, independently of array order. A scene switch preserves the same selected items and IDs; it can change their positions. The wire strategy must never invent an archive or mark an email read because an animation has finished.

Implement the scene in three stages:

1. Draw the three wires with a shallow sag, readable category labels and static perched birds. Define deterministic perch slots with minimum spacing. Keep an occupied slot stable when another bird arrives or leaves. On resize, preserve reservations and reposition the layout gently.
2. Add approach, braking, landing, perched and takeoff states. Reserve a free slot before an arrival approaches. Slow near the perch, place the feet on the wire, fold the wings and settle with a small body movement. Departures release their reservation when clear of the wire. Use the shared renderer’s poses throughout.
3. Replay lifecycle changes. Initial history appears quietly on the wires. A new Inbox email lands; reading changes its appearance subtly; archiving or deletion triggers departure. An agent reply or document edit stirs its existing bird. Keep unknown read state explicit. Agree a bounded recent-activity window for sources without an Inbox.

When capacity is full, select a bounded visible set and show both visible and total counts. Each visible bird still represents one item. Test duplicate and delayed events, departure during landing, repeated scene switches, reconnect snapshots, overflow and phone rotation. Assert that no perch has two reservations and unaffected birds retain theirs. Inspect feet contact, braking and takeoff at normal speed, with a static reduced-motion alternative.

Performance targets remain unverified: 60 fps with 1,000 simple birds on the chosen desktop and 30 fps with 300 on the chosen phone. Perch spacing may impose a smaller visible capacity. Record that capacity, device, browser and two-minute frame-time measurements separately; frame rate does not establish how many birds remain readable.

Related work: [bird rendering](https://github.com/Tobybarnes/murmuration/tree/feature/realistic-birds) and [inputs](https://github.com/Tobybarnes/murmuration/tree/feature/inputs). Start with perch allocation and fixtures; integrate the shared scene extraction before implementing the full animation loop.
