"""Generator tests: browser-made fixtures → 3MF → structural/geometric validation, plus negative cases."""
import copy
import json
import math
import shutil
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import generate_3mf as g  # noqa: E402

TEMPLATE = ROOT / 'assets' / 'h2d-empty.3mf'
FIXTURES = ROOT / 'examples' / 'fixtures'
EXPECTED = {
    '04hp-triangular-facets': {'hp': 4, 'pattern': 'triangular-facets', 'openings': 2},
    '12hp-basket-weave': {'hp': 12, 'pattern': 'basket-weave', 'openings': 4},
    '20hp-pinwheel': {'hp': 20, 'pattern': 'pinwheel', 'openings': 4},
    '20hp-split-regional': {'hp': 20, 'pattern': 'basket-weave', 'openings': 4, 'composition': 'split-y'},
}


def load(name):
    return json.loads((FIXTURES / f'{name}.recipe.json').read_text())


class Tmp(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix='zudo-gen-'))

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def generate(self, recipe, template=TEMPLATE, **kw):
        out = self.dir / 'out.3mf'
        report = g.build(recipe, template, out, **kw)
        return out, report


class FixtureTests(Tmp):
    def test_fixtures_exist(self):
        self.assertEqual(sorted(p.name.split('.')[0] for p in FIXTURES.glob('*.recipe.json')), sorted(EXPECTED))

    def test_fixtures_generate_and_validate(self):
        for name, exp in EXPECTED.items():
            with self.subTest(fixture=name):
                recipe = load(name)
                out, report = self.generate(recipe)
                checks = g.validate_package(out, recipe, TEMPLATE)
                for required in ('body_manifold', 'body_genus', 'body_volume', 'contour_vertices', 'openings_clear', 'region_contract',
                                 'modifier_angle', 'modifier_first_layer_only', 'bed_bounds', 'template_settings_preserved', 'relationships', 'no_gcode'):
                    self.assertIn(required, checks)
                self.assertEqual(report['panel']['hp'], exp['hp'])
                self.assertEqual(report['panel']['openings'], exp['openings'])
                self.assertEqual(report['pattern']['id'], exp['pattern'])
                self.assertEqual(report['pattern']['regions'], len(recipe['artwork']['regions']))
                self.assertAlmostEqual(report['pattern']['coverage'], 1.0, places=3)
                self.assertEqual(report['pattern']['composition'], exp.get('composition', 'single'))
                self.assertAlmostEqual(report['modifier_height_mm'], 0.36)
                self.assertEqual(report['template']['printer_model'], 'Bambu Lab H2D')
                parts = g.inspect(out)['parts']
                self.assertEqual([p['subtype'] for p in parts].count('normal_part'), 1)
                self.assertEqual([p['subtype'] for p in parts].count('modifier_part'), len(recipe['artwork']['regions']))
                self.assertNotIn('negative_part', [p['subtype'] for p in parts], 'openings are baked into the body mesh')

    def test_body_uses_panel_outline_and_openings(self):
        recipe = load('20hp-pinwheel')
        out, _ = self.generate(recipe)
        with ZipFile(out) as z:
            root = ET.fromstring(z.read(g.MODEL))
        body = root.find(f'{g.q("resources")}/{g.q("object")}')
        verts = [(float(v.get('x')), float(v.get('y')), float(v.get('z'))) for v in body.iter(g.q('vertex'))]
        # 4 outline corners + 4 rounded slots, each 4 quarter arcs: far more than a box's 8 vertices.
        self.assertGreater(len(verts), 8 * 4)
        panel = recipe['panel']
        for hole in panel['holes']:
            bx, by = g.to_bed((hole['x'], hole['y']), panel['width'], panel['height'])
            ring = [v for v in verts if v[2] == 0 and abs(math.hypot(v[0] - bx, v[1] - by)) < hole['width']]
            self.assertTrue(ring, 'opening wall vertices exist around each mounting centre')
            xs, ys = [v[0] for v in ring], [v[1] for v in ring]
            self.assertAlmostEqual(max(xs) - min(xs), hole['width'], places=4)
            self.assertAlmostEqual(max(ys) - min(ys), hole['height'], places=4)

    def test_face_down_transform_and_angles(self):
        recipe = load('20hp-pinwheel')
        w, h = recipe['panel']['width'], recipe['panel']['height']
        self.assertEqual(g.to_bed((0, 0), w, h), (w, h))
        self.assertEqual(g.to_bed((w, h), w, h), (0, 0))
        # -I preserves line directions; recipe angles are kept mod 180.
        for a in (0, 30, 90, 135, 179.5):
            self.assertAlmostEqual(g.bed_angle(a, 0), a % 180)
        self.assertAlmostEqual(g.bed_angle(170, 20), 10)

    def test_template_bytes_preserved_and_caches_removed(self):
        out, report = self.generate(load('12hp-basket-weave'))
        with ZipFile(TEMPLATE) as t, ZipFile(out) as z:
            self.assertEqual(t.read(g.SETTINGS), z.read(g.SETTINGS))
            names = set(z.namelist())
            rels = z.read(g.ROOT_RELS).decode()
        self.assertFalse(any(n.endswith('.gcode') for n in names))
        self.assertNotIn('Metadata/slice_info.config', names)
        self.assertNotIn('Metadata/plate_1.png', names)
        self.assertNotIn('plate_1.png', rels)
        self.assertIn('Metadata/plate_1.png', report['removed_template_members'])

    def test_angle_offset_is_applied(self):
        recipe = load('12hp-basket-weave')
        out, _ = self.generate(recipe, angle_offset=90)
        parts = g.inspect(out)['parts']
        mods = [p for p in parts if p['subtype'] == 'modifier_part']
        for part, region in zip(mods, recipe['artwork']['regions']):
            self.assertAlmostEqual(float(part['settings']['infill_direction']), (region['angle'] + 90) % 180)
        g.validate_package(out, recipe, TEMPLATE, angle_offset=90)
        with self.assertRaises(g.RecipeError):
            g.validate_package(out, recipe, TEMPLATE, angle_offset=0)


class NegativeTests(Tmp):
    def expect(self, mutate, message, name='12hp-basket-weave'):
        recipe = load(name)
        mutate(recipe)
        with self.assertRaisesRegex(g.RecipeError, message):
            self.generate(recipe)

    def test_unsupported_patterns(self):
        self.expect(lambda r: r['artwork'].update(kind='custom'), 'Directional regions')
        self.expect(lambda r: r['artwork'].update(composition={'mode': 'overlay'}), 'Overlay')
        self.expect(lambda r: r.update(reference={'name': 'x.png'}), 'Imported images')
        self.expect(lambda r: r.update(schema='zudo-surface-preview/v1'), 'schema')
        self.expect(lambda r: r['artwork'].update(regions=[]), 'no regions')

    def test_invalid_dimensions(self):
        self.expect(lambda r: r['panel'].update(width=0), 'outside the supported')
        self.expect(lambda r: r['panel'].update(height=1000), 'outside the supported')
        self.expect(lambda r: r['panel'].update(studyThickness=20), 'thickness')
        self.expect(lambda r: r['panel'].update(width=r['panel']['width'] + 5), 'outline does not match')
        self.expect(lambda r: r['panel']['holes'][0].update(x=-50), 'not fully inside')
        self.expect(lambda r: r['artwork']['rectangle'].update(y=1), 'overlaps mounting opening|extends outside')

    def test_invalid_coordinates(self):
        self.expect(lambda r: r['artwork']['regions'][0]['polygon'][0].__setitem__(0, 'abc'), 'must be a number')
        self.expect(lambda r: r['artwork']['regions'][0]['polygon'][0].__setitem__(0, float('nan')), 'finite')
        self.expect(lambda r: r['artwork']['regions'][0]['polygon'][0].__setitem__(0, float('inf')), 'finite')
        self.expect(lambda r: r['artwork']['regions'][0].update(polygon=[[1, 2, 3]]), r'\[x, y\]')
        self.expect(lambda r: r['artwork']['regions'][0].update(angle=None), 'must be a number')

    def test_malformed_polygons(self):
        def bowtie(r):
            x, y = r['artwork']['rectangle']['x'] + 1, r['artwork']['rectangle']['y'] + 1
            r['artwork']['regions'][0]['polygon'] = [[x, y], [x + 4, y + 4], [x + 4, y], [x, y + 4]]
        self.expect(bowtie, 'self-intersecting')

        def outside(r):
            r['artwork']['regions'][0]['polygon'] = [[0, 0], [5, 0], [5, 5]]
        self.expect(outside, 'outside the artwork rectangle')

        def overlap(r):
            r['artwork']['regions'].append(copy.deepcopy(r['artwork']['regions'][0]))
        self.expect(overlap, 'overlap')

        def too_complex(r):
            r['artwork']['regions'][0]['polygon'] = [[1, 1]] * 600
        self.expect(too_complex, 'limit')

        def outline_bowtie(r):
            w, h = r['panel']['width'], r['panel']['height']
            r['panel']['outer'] = [[0, 0], [w, h], [w, 0], [0, h]]
        self.expect(outline_bowtie, 'self-intersecting')

    def test_degenerate_regions_are_reported_not_silent(self):
        recipe = load('12hp-basket-weave')
        a = recipe['artwork']['regions'][0]['polygon'][0]
        recipe['artwork']['regions'].append({'polygon': [a, a, a], 'angle': 0})
        _, report = self.generate(recipe)
        self.assertTrue(any('degenerate' in w for w in report['warnings']))

    def test_missing_and_bad_templates(self):
        recipe = load('12hp-basket-weave')
        with self.assertRaisesRegex(g.RecipeError, 'not found'):
            self.generate(recipe, template=self.dir / 'missing.3mf')
        bad = self.dir / 'bad.3mf'
        bad.write_bytes(b'not a zip')
        with self.assertRaisesRegex(g.RecipeError, 'not a valid ZIP'):
            self.generate(recipe, template=bad)
        used, _ = self.generate(recipe)
        nonempty = self.dir / 'nonempty.3mf'
        shutil.copy(used, nonempty)
        with self.assertRaisesRegex(g.RecipeError, 'empty saved project'):
            g.build(recipe, nonempty, self.dir / 'x.3mf')

    def test_validator_detects_tampering(self):
        recipe = load('12hp-basket-weave')
        out, _ = self.generate(recipe)
        with ZipFile(out) as z:
            data = {n: z.read(n) for n in z.namelist()}
        data[g.SETTINGS] = data[g.SETTINGS].replace(b'"wall_loops": "2"', b'"wall_loops": "5"')
        data['Metadata/plate_1.gcode'] = b'G28'
        tampered = self.dir / 'tampered.3mf'
        g.write_zip(data, tampered)
        with self.assertRaisesRegex(g.RecipeError, 'differs from the template|G-code'):
            g.validate_package(tampered, recipe, TEMPLATE)


class CliTests(Tmp):
    def run_cli(self, *args):
        return subprocess.run([sys.executable, str(ROOT / 'scripts' / 'generate_3mf.py'), *map(str, args)], capture_output=True, text=True)

    def test_cli_generate_validate_inspect(self):
        out = self.dir / 'cli.3mf'
        r = self.run_cli('generate', '--template', TEMPLATE, '--recipe', FIXTURES / '20hp-split-regional.recipe.json', '--output', out)
        self.assertEqual(r.returncode, 0, r.stderr)
        report = json.loads(r.stdout)
        self.assertEqual(report['validation']['status'], 'passed')
        self.assertNotIn(str(ROOT), json.dumps(report['template']))
        r = self.run_cli('validate', '--template', TEMPLATE, '--recipe', FIXTURES / '20hp-split-regional.recipe.json', '--output', out)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertFalse(json.loads(self.run_cli('inspect', out).stdout)['contains_toolpaths'])

    def test_cli_errors_are_json(self):
        bad = self.dir / 'bad.json'
        bad.write_text('{"schema": "zudo-surface-preview/v2", "panel": {"width": NaN}}')
        r = self.run_cli('generate', '--template', TEMPLATE, '--recipe', bad, '--output', self.dir / 'x.3mf')
        self.assertEqual(r.returncode, 2)
        self.assertIn('error', json.loads(r.stderr))
        self.assertFalse((self.dir / 'x.3mf').exists())

    def test_template_info(self):
        r = self.run_cli('template-info', TEMPLATE)
        info = json.loads(r.stdout)
        self.assertEqual(info['printer_model'], 'Bambu Lab H2D')
        self.assertEqual(info['initial_layer_height_mm'], 0.3)
        self.assertEqual(info['modifier_top_mm'], 0.36)


if __name__ == '__main__':
    unittest.main()
