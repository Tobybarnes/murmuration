# Setup status

Verified on 7 October 2026.

The visualizer is live at https://murmuration-sepia.vercel.app. Vercel project `murmuration` belongs to the personal `toby-barnes-projects-688b62f3` scope. Its production deployment is `dpl_7p4uGQpj27R2efH2eR5pN71cVQEB`, built from local application commit `5e74855`. The page is reachable without authentication and its HTML SHA-256 matches the tested local file.

## Verified

- All 12 unit tests pass, including finite flock state at maximum density, consistent 60/120Hz simulation, pause, hidden-tab lifecycle, cleanup, saved settings and MIDI mapping.
- JavaScript syntax checks and the static build pass.
- The live canvas animates and displays the sixteen controls without captured browser warnings or errors.
- Desktop controls, count changes, pause/resume, scatter, reset, settings persistence, and H hide/show were exercised in the browser.
- Phone layouts at 390 × 844 and 320 × 740 were inspected; the document has no horizontal overflow. This is browser viewport testing, not physical-phone testing.
- The original colour interpolation remains on the canvas, with a separate readable UI palette at intermediate theme values.

Physical MIDI hardware has not been tested. Fullscreen was attempted in the Codex in-app browser, which did not confirm entry; verify it in a normal browser. No communication accounts are connected.

## Remaining GitHub setup

The intended repository is private `Tobybarnes/murmuration`. GitHub authentication is confirmed as `Tobybarnes` with the `repo` and `workflow` scopes. Repository creation failed through both GraphQL and REST, including repeated HTTP 500 responses with empty bodies. A subsequent read returned 404. The latest failed request was at 16:56:05 UTC, request ID `273C:3D6743:15FCAD:1DFE69:6AC679A4`. This is an unresolved server error; permission to create repositories is present.

The local project is already a Git repository on `main`, with a personal GitHub noreply commit address. No remote repository or automatic Git deployment has been verified. To finish after GitHub accepts creation:

1. Check whether `Tobybarnes/murmuration` now exists before retrying creation.
2. If absent, create it as a private, empty repository. Add its remote and push `main`.
3. Run `vercel git connect https://github.com/Tobybarnes/murmuration --scope toby-barnes-projects-688b62f3` from this project.
4. Confirm the remote commit matches local `HEAD`, GitHub Actions passes, and a Git-triggered Vercel deployment reaches Ready and renders correctly.

Only the simulation and public source assets are in the deployed build. Local `.env` files and `.vercel/` metadata are ignored by Git and excluded from the source archive.
