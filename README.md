# zudo-bambu-blanks

Local, browser-based surface designer and **unsliced** Bambu Studio 3MF generator for Takazudo Modular synth blank panels.

```text
npm install → npm run dev → http://127.0.0.1:4173
→ choose panel size + Directional regions pattern
→ adjust the artwork rectangle / transform
→ Make 3MF → Generating → Validating → Download 3MF
→ open in Bambu Studio, inspect layers 1–2, slice yourself
```

Personal-first: it runs on your Mac, binds to `127.0.0.1`, and never talks to a printer.

> **Status: experimental.** Generated projects pass automated structural and geometric validation, but Bambu Studio has **not** yet opened or sliced them in a confirmed run, and no physical print has been checked. Studio confirmation is tracked in [#2](https://github.com/Takazudo/zudo-bambu-blanks/issues/2). Do not treat the output as print-ready until that is done.

## Requirements

| Tool | Version | Used for |
| --- | --- | --- |
| Node.js | 20.11+ (22 LTS recommended) | build, local server, tests |
| npm | bundled with Node | install from `package-lock.json` |
| Python | 3.10+ (stdlib only, no pip packages) | 3MF generation and validation |
| Chromium via Playwright | optional | browser tests only |

macOS ships `python3` with the Xcode command line tools; Homebrew/pyenv Pythons work too. If your interpreter has another name, set `PYTHON=/path/to/python3`.

## Setup and run

```bash
git clone https://github.com/Takazudo/zudo-bambu-blanks.git
cd zudo-bambu-blanks
npm ci          # or npm install
npm run dev
```

Open <http://127.0.0.1:4173>. The terminal prints the template summary and the Python version it found; if Python or the template is missing, the app still runs and the Make 3MF dialog explains what is missing.

`npm run dev` rebuilds `dist/` on start. `dist/`, `.tmp/` and `node_modules/` are generated and ignored by Git.

## Using the app

1. Pick a panel size (1–20 HP Eurorack 3U, real outline and mounting slots from zudo-blanks).
2. Pick a pattern. All 78 studies preview; only **Directional regions** patterns (route tag “Regional fill study”) can become a 3MF.
3. Adjust motif size, rotation, stretch, offset, symmetry or a split composition. The end zones (default 12.25 mm) keep the mounting areas outside the artwork rectangle.
4. Click **Make 3MF**. The dialog shows the template/printer profile, panel, pattern, number of modifier regions, modifier height and that the output is unsliced.
5. Click **Generate**. Progress goes *Generating → Validating → Download available*. Validation warnings (for example very small regions) appear under the progress.
6. Click **Download 3MF** and open the file in Bambu Studio as a project.

Recipes (**Save recipe** / **Open recipe**), favorites, saved designs, variations and PNG/SVG export work as before.

## What the 3MF contains

One object on plate 1, built from the saved H2D template:

| Part | Subtype | Geometry | Per-part settings |
| --- | --- | --- | --- |
| Panel | `normal_part` | recipe `panel.outer` extruded to the chosen thickness, with the mounting slots cut through the mesh | `bottom_surface_pattern=monotonic`, `infill_direction=45` (plain treatment outside the artwork rectangle) |
| Pattern region *n* | `modifier_part` | one prism per recipe region, 0 → modifier height | `bottom_surface_pattern=alignedrectilinear`, `bottom_surface_density=100%`, `infill_direction=<region angle>` |

- **Modifier height** is derived from the template: `initial_layer_print_height + layer_height / 4` (0.36 mm for the bundled 0.3 mm / 0.24 mm profile). It is checked to contain the first layer's slice plane and stay below the second layer's.
- **Face-down transform.** The decorated face prints on the plate. Finished-face coordinates (X right, Y down, seen from the front) map to the plate as `x' = W − x`, `y' = H − y` (the panel flipped over its vertical axis). Line angles are unchanged mod 180° by that transform. Whether Studio's `infill_direction` needs an extra offset is part of #2; set `BAMBU_ANGLE_OFFSET=<degrees>` to experiment.
- **Placement**: centred in the area both H2D nozzles can reach, clear of the wrapping exclusion zone.
- **Removed from the template**: plate thumbnails, `slice_info.config`, `filament_sequence.json` and any G-code or slice cache, together with the relationships and plate metadata that pointed at them.
- **Preserved byte-for-byte**: `project_settings.config` (printer, nozzles, filaments, machine G-code, process).

The mounting openings are part of the body mesh rather than `negative_part` volumes, so they do not depend on Studio's boolean handling.

## Printable pattern families

| Family | Kind | Make 3MF |
| --- | --- | --- |
| Directional regions (20 patterns: triangular facets, basket weave, chevron, sunburst, facet quilt, diamond facets, pinwheel, prism cubes, parquet, tatami, running brick, windmill, diagonal bands, quarter-sawn, Voronoi facets, fractured glass, triangle tessellation, hex facets, nested frames, offset quilt) | `regional` | Yes, including symmetry, transforms and split compositions of two regional patterns |
| Waves & flow, Contours & grain, Lattices & tiles, Truchet & mazes, Radial & guilloché, Optical & textile, Generative | `custom` / `artwork` | No, preview only |
| Imported images | `image` | No, preview only |
| Overlay compositions | any | No, preview only |

Curves, images and overlays need a separate manufacturing adapter (bead spacing, coverage, intersections). They are refused, not approximated.

## Template configuration

The canonical template is `assets/h2d-empty.3mf`: an empty Bambu Studio 2.08 project for an H2D with 0.6 mm nozzles, PLA, 0.24 mm Balanced Strength, copied from the `bambu-3mf` skill in `Takazudo/claude-settings`.

To use another saved empty project:

```bash
BAMBU_TEMPLATE=/absolute/path/to/empty.3mf npm run dev
```

Save the template from Bambu Studio with no objects on the plate. The generator refuses templates that contain objects, lack `printable_area`/layer heights, or do not define `bottom_surface_pattern`, `bottom_surface_density` and `infill_direction`. Use a matching Studio-saved template for another printer or nozzle instead of editing settings by hand.

Other environment variables: `PORT` (default 4173), `PYTHON`, `BAMBU_ANGLE_OFFSET`, `GENERATOR_TIMEOUT_MS` (90000), `MAX_CONCURRENT_JOBS` (1), `MAX_QUEUED_JOBS` (4), `MAX_RETAINED_JOBS` (20), `JOB_RETENTION_HOURS` (24).

## Local API

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/status` | Python + template summary (no local paths) |
| `POST` | `/api/jobs` | body: v2 recipe as `application/json`, ≤ 4 MB → `202` job |
| `GET` | `/api/jobs/:id` | `phase`: `queued` / `generating` / `validating` / `ready` / `failed`, warnings, summary |
| `GET` | `/api/jobs/:id/download` | the `.3mf` once `ready` |

Requests must be addressed to `127.0.0.1`/`localhost` (DNS-rebinding guard); cross-origin requests are refused. Jobs run one at a time with a timeout and are kept in `.tmp/jobs/<id>/` (`recipe.json`, `report.json`, `job.json`, `project.3mf`) for debugging, pruned to the newest 20 and 24 hours.

The generator can also be used directly:

```bash
python3 scripts/generate_3mf.py generate --template assets/h2d-empty.3mf \
  --recipe examples/fixtures/20hp-pinwheel.recipe.json --output pinwheel.3mf
python3 scripts/generate_3mf.py validate --template assets/h2d-empty.3mf \
  --recipe examples/fixtures/20hp-pinwheel.recipe.json --output pinwheel.3mf
python3 scripts/generate_3mf.py inspect pinwheel.3mf
python3 scripts/generate_3mf.py template-info assets/h2d-empty.3mf
```

## Tests

```bash
npm test                 # generator unit tests + full local API tests
npx playwright install chromium
npm run test:e2e         # real app in Chromium: 3D/flat, patterns, recipes, Make 3MF, mobile, all regional patterns
npm run fixtures         # regenerate examples/fixtures from the real app
```

CI runs the generator on Python 3.10 and 3.13, and the API and browser suites on Node 20 and 22.

### What validation covers, and what it does not

Covered automatically: recipe contract (finite numbers, simple polygons, regions inside the artwork rectangle, no overlaps, coverage, complexity limits), panel outline and opening positions/sizes in the mesh, closed oriented 2-manifold meshes with the expected genus and volume, modifier height window, region-to-modifier correspondence and angles, plate bounds, package relationships and content types, template settings unchanged, no G-code or slice cache.

Not covered: how Bambu Studio interprets the parts and settings, the visible grain direction, perimeter interaction with small regions, and print quality. See [docs/STUDIO-VALIDATION.md](docs/STUDIO-VALIDATION.md).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| “Python was not found” in the dialog | Install Python 3.10+ or start with `PYTHON=/path/to/python3 npm run dev` |
| “bundled H2D template … is missing” | Restore `assets/h2d-empty.3mf` from Git |
| “BAMBU_TEMPLATE was not found” | Use an absolute path to an existing `.3mf` |
| “Template must be an empty saved project” | Save a template with nothing on the plate |
| Make 3MF button says “3MF preview only” | Choose a Directional regions pattern, clear any imported image, leave overlay mode |
| “Artwork rectangle overlaps mounting opening” | Increase the end zone so the artwork clears the slots |
| “Pattern has … regions; the limit is 1500” or a timeout | Increase motif size |
| 3D view is grey and shows “3D is unavailable” | WebGL is off or Three.js did not load; run `npm install`. Flat view and generation still work |
| `Port 4173 is already in use` | Stop the other server or run `PORT=4174 npm run dev` |
| A job failed | Read the message in the dialog; the recipe and report are in `.tmp/jobs/<id>/` |

## Architecture

```text
web/src (Surface Lab v2)            scripts/build.mjs → dist/
   │  recipe (zudo-surface-preview/v2) = geometry contract
   ▼
scripts/server.mjs (127.0.0.1)  ──  async job queue, timeout, retention
   │  python3 scripts/generate_3mf.py generate / validate   (no shell)
   ▼
assets/h2d-empty.3mf + panel body + first-layer modifiers → .tmp/jobs/<id>/project.3mf
```

The backend never re-derives pattern shapes. Panel outline, openings, artwork rectangle, region polygons and angles all come from the browser recipe.

See [docs/PLAN.md](docs/PLAN.md) for the roadmap, including optional Bambu Studio CLI slicing.
