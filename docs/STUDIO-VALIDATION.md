# Bambu Studio validation (issue #2)

Automated tests prove the generated archives are structurally and geometrically consistent with the recipe and the template. They do **not** prove that Bambu Studio reads them as intended. These checks need Bambu Studio (2.08 or the version that saved the template) on the Mac, and ideally the H2D.

Nothing in this repository has been confirmed in Studio yet. Record results in [#2](https://github.com/Takazudo/zudo-bambu-blanks/issues/2).

## Prepare the fixture projects

```bash
npm ci
mkdir -p studio-check
for f in examples/fixtures/*.recipe.json; do
  python3 scripts/generate_3mf.py generate --template assets/h2d-empty.3mf \
    --recipe "$f" --output "studio-check/$(basename "$f" .recipe.json).3mf"
done
```

Optional angle-convention probe (same geometry, every modifier rotated 90°):

```bash
python3 scripts/generate_3mf.py generate --template assets/h2d-empty.3mf \
  --recipe examples/fixtures/12hp-basket-weave.recipe.json \
  --output studio-check/12hp-basket-weave-offset90.3mf --angle-offset 90
```

| Fixture | What it isolates |
| --- | --- |
| `04hp-triangular-facets` | 8 large regions, 3 angles (0°, 60°, 120°). Easiest to see |
| `12hp-basket-weave` | 35 cells alternating 0° / 90°. Angle convention and repeatability |
| `20hp-pinwheel` | 196 regions, asymmetric. Mirroring / finished-face orientation |
| `20hp-split-regional` | Basket weave over diagonal bands, split top/bottom. Clipping at the composition seam |

## Before slicing (object list)

For each project, open it as a project (File → Open Project), then check:

1. One object named `Zudo blank <n>HP — <pattern>` on plate 1, centred, inside the plate.
2. One part `Panel` (normal part) whose outline matches the panel, with **through** mounting slots in the right places.
3. `Pattern region k (<angle>°)` parts shown as **modifiers** (not printable solids), each with the overrides `bottom_surface_pattern = Aligned Rectilinear`, `bottom_surface_density = 100%`, `infill_direction = <angle>`.
4. Printer, nozzle, filament and process match the template (H2D 0.6 mm, 0.24 mm Balanced Strength, PLA) and Studio reports no modified/foreign settings.
5. Studio shows no import warnings.

## Slice, then inspect layers 1 and 2

6. Slice the plate. Note any warnings.
7. **Layer 1**: inside the artwork rectangle each region shows its own line direction; outside it (end zones and side borders) the plain monotonic 45° fill.
8. **Layer 2**: uniform; no region seams or direction changes, i.e. the modifiers stopped after the first layer (modifier top 0.36 mm, layer 2 slice plane 0.42 mm).
9. The pattern stops exactly at the artwork rectangle and not on the mounting zones.
10. Small regions (the report warns about regions < 0.5 mm²) may disappear under perimeters; note whether that is acceptable.

## Orientation and angle calibration

11. **Mirroring.** In Surface Lab, pinwheel facets have a definite handedness seen from the front. Look at the sliced layer 1 *from below* (or flip the camera). If it matches the Surface Lab front view, the current `x' = W − x, y' = H − y` face-down transform is right. If it is mirrored, record which axis.
12. **Angle convention.** In Surface Lab, basket-weave 0° cells show lines running left–right on the finished face. Check whether Studio's layer 1 lines in those cells run along the plate's X axis. If they are perpendicular, the fix is `BAMBU_ANGLE_OFFSET=90` (or `ANGLE_OFFSET_DEG` in `scripts/generate_3mf.py`); compare with the `-offset90` probe.
13. For the triangular facets (0°, 60°, 120°), confirm the rotation sense as well as the axis. Seen from below, the face-down transform keeps line angles unchanged mod 180°.

## Optional physical print

14. Print `04hp-triangular-facets` and confirm the visible sheen boundaries, the slot fit on a rail, and that layer 1 adhesion is fine with aligned rectilinear.

## Record and close

Post per-fixture results, Studio version, screenshots of the object list and layers 1–2, and any offset or mirror decision in #2. Then codify the decision (and its test) in `scripts/generate_3mf.py`. Close #2 only after Studio has actually opened and sliced the fixtures.
