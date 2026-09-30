# zudo-bambu-blanks

Local browser-based design and Bambu Studio 3MF generator for Takazudo Modular blank panels.

This repository combines the **Zudo Surface Lab** panel/pattern preview with a localhost generator backed by the H2D empty project template from `claude-settings/skills/bambu-3mf`.

## Current milestone

- `npm run dev` starts a localhost-only web app.
- The Surface Lab UI contains 78 procedural pattern studies and the zudo-blanks panel catalog.
- **Regional** patterns can use **Make 3MF**.
- The backend converts the current recipe into one multipart Bambu Studio project:
  - panel body → `normal_part`
  - mounting holes / slots → `negative_part`
  - first-layer directional cells → `modifier_part`
- The result is an **unsliced `.3mf`** using the saved H2D printer/process template.
- The browser automatically downloads the generated project.

Curves, image imports, and overlay compositions remain preview-only until they have an explicit manufacturing adapter. The app intentionally refuses those cases rather than approximating them silently.

## Run

Requirements:

- Node.js 20+
- Python 3.10+

```bash
npm install
npm run dev
```

Then open:

```text
http://127.0.0.1:4173
```

The server binds to localhost only.

### Template

The default template is:

```text
assets/h2d-empty.3mf
```

It is copied from the Bambu 3MF skill in `Takazudo/claude-settings` and is the project baseline for the author's H2D / 0.6 mm setup.

To use another saved empty project locally:

```bash
BAMBU_TEMPLATE=/absolute/path/to/empty.3mf npm run dev
```

Different printers, nozzle arrays, filament mappings, or process assumptions should use a matching Studio-saved empty template rather than patching this one casually.

## Generate a project

1. Choose a panel size.
2. Choose a pattern labeled as a **regional** design.
3. Adjust artwork rectangle / transformations.
4. Click **Make 3MF**.
5. The localhost backend writes the current v2 recipe, generates the multipart project, and returns a download URL.
6. Open the result in Bambu Studio.
7. Slice and inspect at least the first two layers before printing.

`Make 3MF` does **not** invoke Bambu Studio or start a print.

## Architecture

```text
Browser / Surface Lab
        |
        | POST /api/3mf (zudo-surface-preview/v2 recipe)
        v
localhost Node server
        |
        | python3 scripts/generate_3mf.py
        v
H2D empty template + multipart geometry
        |
        v
.tmp/jobs/<id>.3mf
        |
        v
browser download
```

The recipe is the contract between preview and manufacturing. Panel dimensions, mounting geometry, artwork rectangle, region polygons, and angles are not recalculated independently on the backend.

## Important validation boundary

The generator currently verifies its own input constraints and package structure, and generated ZIP archives are suitable for Studio testing. It does **not** claim that Bambu Studio loaded/sliced the file in CI or that a physical part was printed successfully.

For asymmetric designs, finished-face mirroring/orientation still needs a Studio check. Modifier angle interpretation also needs continued physical calibration against the intended visible grain direction.

See [docs/PLAN.md](docs/PLAN.md) for the development sequence.