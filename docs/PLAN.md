# Development plan

## Goal

Make panel surface experimentation feel like a normal local design tool:

```text
npm run dev → design in browser → Make 3MF → download project → inspect / slice / print in Bambu Studio
```

Personal-first. The default environment is the author's saved H2D template, not a generic multi-printer service. Tracker: [#3](https://github.com/Takazudo/zudo-bambu-blanks/issues/3).

## Phase 1 — local generator bridge (done, PR #1)

- Surface Lab v2 ported: 78 pattern studies, panel catalog, recipes, favorites, variations.
- Localhost server and Python stdlib generator built on the H2D empty template.

## Phase 1.5 — stabilization (done, #4–#7)

- **App (#4):** Three.js add-ons loaded through an import map; RoomEnvironment was never loaded before, so the app always fell back to flat view. Node build into ignored `dist/`, `package-lock.json`, Playwright tests on desktop and mobile.
- **Geometry (#5):** body built from `panel.outer` with openings cut into one closed mesh; explicit face-down transform for polygons and angles; strict recipe validation (finite, simple, inside the rectangle, non-overlapping, bounded complexity); modifier height derived from template layer heights; plate bounds from the per-nozzle printable areas; part settings checked against template keys; dangling thumbnail relationships removed; separate `validate` pass that re-opens the archive.
- **Workflow (#6):** async job queue (concurrency, queue limit, timeout, output cap, retention), phases and warnings in a compact Make 3MF dialog, safe filenames, no paths in responses, localhost host/origin checks.
- **Verification (#7):** four browser-made fixtures, negative tests, end-to-end API and browser tests (including every regional pattern on four panel sizes) in CI.

## Phase 2 — Studio confirmation and calibration (next, #2)

Follow [STUDIO-VALIDATION.md](STUDIO-VALIDATION.md):

- Confirm part roles, modifier overrides and first-layer-only behaviour in the installed Studio version.
- Decide the face-down mirror (currently `x' = W − x, y' = H − y`) and the `infill_direction` offset (currently 0°) from the pinwheel and basket-weave fixtures; codify both with tests.
- Decide whether the plain monotonic 45° treatment and the tiny-region warning threshold are right.
- After confirmation, drop the “experimental” label.

## Phase 3 — generation UX polish

- Recent jobs list with explicit cleanup.
- “Reveal in Finder” for the generated file (macOS only, opt-in).
- Mirror / angle-offset controls in the dialog once Phase 2 picks defaults.
- Option to merge tiny regions into a neighbour instead of only warning.

## Phase 4 — more printable adapters

Do not treat every visual algorithm as printable. Add explicit adapters by family, each with coverage, spacing, intersection, wall-interaction and extrusion rules defined first:

1. regional partitions (current)
2. deterministic line families / crosshatch
3. continuous waves with constant normal spacing
4. Truchet curves with join rules
5. imported SVG paths with stroke-to-toolpath constraints

## Phase 5 — optional local Bambu Studio CLI

Only after Phase 2. Bambu Studio ships a command-line mode in the app bundle (`/Applications/BambuStudio.app/Contents/MacOS/BambuStudio`). Options to evaluate:

- **Headless slice check:** after generation, run Studio's CLI slice on the unsliced project with its embedded settings and report success, warnings and estimated time. Keep the unsliced project as the deliverable.
- **Layer preview:** export the sliced result and render layers 1–2 to images for the dialog.
- **Discovery:** find the CLI path on macOS, show the version, make the feature opt-in, never required.
- Keep embedded project settings; do not pass flags that update configuration values.
- Never send a print. Any future print action must be separate and explicit.

## Non-goals

Hosted slicing service, multi-user profile management, remote printer control, treating visual-only patterns as manufacturable.
