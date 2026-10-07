# Setup status

Verified on 7 October 2026.

The visualizer is live at https://murmuration-sepia.vercel.app, with source at https://github.com/Tobybarnes/murmuration. Vercel project `murmuration` belongs to the personal `toby-barnes-projects-688b62f3` scope and is connected to that repository. The production page is reachable without authentication and its HTML SHA-256 matches the tested local file.

## Verified

- All 11 unit tests pass, including finite flock state at maximum density, consistent 60/120Hz simulation, pause, hidden-tab lifecycle, cleanup and saved settings.
- JavaScript syntax checks and the static build pass.
- The live canvas animates and displays the sixteen controls without captured browser warnings or errors.
- Desktop controls, count changes, pause/resume, scatter, reset, settings persistence, and H hide/show were exercised in the browser.
- Phone layouts at 390 × 844 and 320 × 740 were inspected; the document has no horizontal overflow. This is browser viewport testing, not physical-phone testing.
- The original colour interpolation remains on the canvas, with a separate readable UI palette at intermediate theme values.

Fullscreen was attempted in the Codex in-app browser, which did not confirm entry; verify it in a normal browser. No communication accounts are connected.

## GitHub and Vercel

The public `Tobybarnes/murmuration` repository was supplied by Toby and contains the application, roadmap, source attribution and validation workflow. The local branch tracks `origin/main`. Commits use Toby’s personal GitHub noreply address. This repository’s local Git credential helper uses the verified personal `Tobybarnes` login.

Vercel’s Git integration connects the repository to the existing production project. Pushes to `main` create production deployments; other branches create previews. The `Check` GitHub Actions workflow runs independently and has passed for the published application. Vercel deployment status and workflow results appear on the GitHub commit.

Only the simulation and public source assets are in the deployed build. Local `.env` files and `.vercel/` metadata are ignored by Git and excluded from the source archive.
