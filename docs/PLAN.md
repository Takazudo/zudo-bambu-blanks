# Development plan

## Goal

Make panel surface experimentation feel like a normal local design tool:

```text
npm run dev
→ design in browser
→ Make 3MF
→ download project
→ inspect / slice / print in Bambu Studio
```

The app is personal-first. The default environment is the author's saved H2D template rather than a generic multi-printer cloud service.

## Phase 1 — local generator bridge (implemented in initial pass)

- Port Surface Lab v2 into this repository.
- Keep real panel geometry and exact artwork-rectangle behavior.
- Run a dependency-free localhost Node service.
- Add `POST /api/3mf` and download endpoint.
- Package panel body, negative mounting volumes, and regional modifier volumes into the H2D template.
- Refuse non-regional patterns and overlay composition.
- Keep output unsliced.

### Acceptance checks

- `npm run dev` starts from a clean clone with Node + Python.
- `/api/status` reports template availability.
- A regional v2 recipe returns a downloadable 3MF.
- Generated project has one panel object, negative mounting parts, and modifier parts.
- Stale toolpaths / slice metadata are absent.

## Phase 2 — Studio confirmation and calibration

This is the next highest-value work because file structure alone cannot confirm slicer semantics.

- Open representative generated projects in the installed Bambu Studio version.
- Confirm all part roles appear correctly in the object tree.
- Confirm mounting negative volumes subtract as expected.
- Confirm modifiers only affect the intended first layer.
- Confirm `bottom_surface_pattern=alignedrectilinear` + `infill_direction` produces the intended grain direction.
- Decide and codify finished-face mirroring for asymmetric designs.
- Save fixture screenshots / notes and add regression recipes.

Recommended fixtures:

1. 4 HP, 3 large facets — easy to inspect.
2. 12 HP basket weave — repeated 0° / 90° regions.
3. 20 HP pinwheel — asymmetric direction test.
4. 20 HP split composition — region clipping test.

## Phase 3 — generation UX

- Add a generation drawer with template/printer summary before execution.
- Show generated filename, region count, modifier height, and warnings.
- Keep recent local jobs with explicit cleanup.
- Add “Open recipe folder” / “Reveal generated file” where platform integration is appropriate.
- Add a manual mirror toggle once Phase 2 decides the default.

## Phase 4 — broader printable pattern adapters

Do not interpret every visual algorithm as printable automatically. Add explicit adapters by family.

Potential order:

1. regional partitions — current path
2. deterministic line families / crosshatch
3. continuous waves with constant normal spacing
4. Truchet curves with intersection/join rules
5. imported SVG paths with stroke-to-toolpath constraints

Each adapter needs coverage, spacing, intersections, wall interaction, and extrusion semantics defined before enabling `Make 3MF`.

## Phase 5 — optional local Bambu CLI integration

Only after the generated projects are stable:

- Discover installed Bambu Studio CLI path.
- Add optional `Generate + slice` action.
- Stream subprocess status to the UI.
- Keep generated unsliced project separately.
- Never submit a physical print without a separate explicit action.

## Non-goals for now

- Public hosted slicing service.
- Multi-user printer/profile management.
- Remote printer control.
- Pretending visual-only patterns are already manufacturable.
