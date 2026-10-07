# Source and attribution

The flocking simulation and dot/link drawing code in `src/simulation.js`, and the sixteen parameter definitions in `src/parameters.js`, are adapted from [Ben Bashford’s Murmuration](https://benbashford.com/experiments/murmuration/murmuration.html). The original page identifies Ben Bashford as its author. Source retrieved on 7 October 2026.

The adaptation preserves the original 3D boids calculations, spatial hash, neighbour limits, perspective projection, dotted connections, predator, trails, parameter ranges and colour palettes. It extracts the engine into a module and adds a fixed simulation step, lifecycle cleanup, input validation and a responsive, keyboard-accessible interface. Original generated country labels are replaced with explicit simulation IDs. Web MIDI is enabled by a button instead of requesting access on page load. Analytics and external font requests are removed.

[Voronoi Nodes](https://benbashford.com/experiments/voronoi-nodes/voronoi-nodes.html), also by Ben Bashford, was inspected as the related visual reference. Its p5.js sketch is not part of this app or its runtime dependencies.

Neither inspected source page declares an open-source license. The Voronoi page’s footer states “Copyright 2026. All rights reserved.” This repository records provenance and does not grant a new license over Ben’s work.

SHA-256 of the fetched HTML:

- Murmuration: `78c06bbcb1a37d058e624277364292e02954b26779f8c17a5244faa8a7f32043`
- Voronoi Nodes: `f4f8a6fbd564d1d46ebdd1ab9431a4b3d328f1c8abe9e179799570db9df3ddc9`
