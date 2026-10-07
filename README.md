# Murmuration

An ambient flocking experiment adapted from [Ben Bashford’s original](https://benbashford.com/experiments/murmuration/murmuration.html). It uses plain JavaScript and Canvas 2D, with 3D flock movement projected onto the screen. See [source attribution](ATTRIBUTION.md).

[Open the live visualizer](https://murmuration-sepia.vercel.app) or [browse the GitHub project](https://github.com/Tobybarnes/murmuration). Deployment and verification details are in [setup status](docs/SETUP-STATUS.md).

This first version has simulated dots, connected-node drawing, sixteen controls, pointer attraction, scatter, pause, trails and a predator. Settings stay in this browser. It makes no account connections and sends no analytics.

## Run locally

Use Node.js 22 or newer. There are no package dependencies.

```sh
npm ci --ignore-scripts
npm run dev
```

Open `http://127.0.0.1:5173`. Run `npm run check`, `npm test`, and `npm run build` before pushing. `npm run preview` serves the built `dist/` directory on the same port.

## Controls

Choose **Tune flock** to open the sixteen sliders. Use arrow keys on a focused slider; double-click it to restore its default. Hold the canvas to attract the flock with a mouse, pen or touch. The buttons provide pause, scatter, fullscreen and a way to hide the interface.

Keyboard shortcuts: Space pauses, S scatters, R resets, H hides or shows the interface, and F toggles fullscreen. Reduced-motion preferences start the animation paused. Hidden tabs stop simulation work.

## Project layout

- `src/simulation.js`: Flock movement, Canvas rendering and animation lifecycle.
- `src/parameters.js`: Original parameter definitions and value conversion.
- `src/main.js`: Interface and pointer/keyboard controls.
- `src/storage.js`: Local settings.
- `src/style.css`: Responsive interface and both colour themes.
- `docs/ROADMAP.md`: Realistic birds, communication inputs and sky/wire scenes.

Vercel builds with `npm run build` and serves `dist/`. The project is connected to `Tobybarnes/murmuration`: pushes to `main` deploy to production, and other branches get previews. GitHub Actions runs syntax checks, unit tests and the build independently. Future private-data adapters must add authentication and server-side storage before real accounts are connected.
