#!/usr/bin/env python3
"""Zudo blank-panel → Bambu Studio 3MF generator and validator (Python stdlib only).

The browser recipe (schema ``zudo-surface-preview/v2``) is the geometry contract:
panel outline, mounting openings, artwork rectangle and region polygons/angles
come from Surface Lab and are never re-derived here. This script only converts,
checks and packages them.

Subcommands
  generate      recipe + template -> unsliced .3mf (+ JSON report on stdout)
  validate      re-open a generated .3mf and check it against recipe + template
  inspect       short structural summary of any .3mf
  template-info printer/process summary of a template (no paths)

Exit codes: 0 ok, 2 invalid input / validation failure, 3 internal error.
"""
from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import math
import re
import sys
import tempfile
import uuid
from datetime import date
from pathlib import Path, PurePosixPath
import xml.etree.ElementTree as ET
from zipfile import ZIP_DEFLATED, BadZipFile, ZipFile

GENERATOR_VERSION = '0.2.0'
RECIPE_SCHEMA = 'zudo-surface-preview/v2'

CORE = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02'
PROD = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06'
BBL = 'http://schemas.bambulab.com/package/2021'
RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types'
MODEL = '3D/3dmodel.model'
SETTINGS = 'Metadata/project_settings.config'
OBJECTS = 'Metadata/model_settings.config'
ROOT_RELS = '_rels/.rels'
CONTENT_TYPES = '[Content_Types].xml'
IDENTITY = '1 0 0 0 1 0 0 0 1 0 0 0'
MATRIX4 = '1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1'
ET.register_namespace('', CORE)
ET.register_namespace('p', PROD)
ET.register_namespace('BambuStudio', BBL)

# Bambu Studio volume types as written in model_settings.config <part subtype=...>.
PART_SUBTYPES = {'normal_part', 'modifier_part', 'negative_part', 'support_blocker', 'support_enforcer'}
# Per-part overrides this generator writes. Each key must also exist in the
# template's project_settings.config, which is checked at generation time.
SURFACE_PATTERNS = {'monotonic', 'monotonicline', 'alignedrectilinear', 'zig-zag', 'concentric',
                    'hilbertcurve', 'archimedeanchords', 'octagramspiral'}
PART_SETTING_KEYS = {'bottom_surface_pattern', 'bottom_surface_density', 'infill_direction'}

# Finished face prints face-down. Finished-face coordinates (X right, Y down,
# seen from the front) map to part-local bed coordinates (X right, Y up, seen
# from above) by flipping the panel over its vertical axis:
#     bed_x = W - x,  bed_y = H - y
# The linear part is -I, so a line direction keeps its angle mod 180°.
# Whether Studio's infill_direction needs an extra offset is tracked in issue #2;
# ANGLE_OFFSET_DEG / --angle-offset exist so that calibration is a one-line change.
FACE_DOWN_MIRROR = 'x'
ANGLE_OFFSET_DEG = 0.0

LIMITS = {
    'max_regions': 1500,
    'max_region_vertices': 512,
    'max_total_vertices': 60000,
    'max_holes': 16,
    'max_outer_vertices': 512,
    'panel_max_mm': 300.0,
    'thickness_mm': (0.6, 8.0),
    'min_region_area_mm2': 1e-4,
    'tiny_region_area_mm2': 0.5,
    'coverage_warn': 0.995,
}
TOL = 1e-3  # geometric tolerance in mm for contract checks

CACHE_MEMBERS = {'Metadata/slice_info.config', 'Metadata/filament_sequence.json', 'Metadata/layer_height_profile.txt',
                 'Metadata/layer_config_ranges.xml', 'Metadata/cut_information.xml', 'Metadata/custom_gcode_per_layer.xml'}
PLATE_IMAGE_KEYS = {'thumbnail_file', 'thumbnail_no_light_file', 'top_file', 'pick_file', 'pattern_file', 'pattern_bbox_file'}


class RecipeError(ValueError):
    """Input or validation failure that should be shown to the user."""


def fail(msg):
    raise RecipeError(msg)


def q(tag):
    return f'{{{CORE}}}{tag}'


def fmt(v):
    v = float(v)
    if abs(v) < 5e-13:
        v = 0.0
    return format(v, '.12g')


def xml_bytes(root):
    ET.indent(root, space='  ')
    return ET.tostring(root, encoding='utf-8', xml_declaration=True)


def sha256(b):
    return hashlib.sha256(b).hexdigest()


# --------------------------------------------------------------------------- 2D geometry

def num(value, name):
    try:
        v = float(value)
    except (TypeError, ValueError):
        fail(f'{name} must be a number')
    if not math.isfinite(v):
        fail(f'{name} must be finite')
    return v


def point_list(raw, name, max_points):
    if not isinstance(raw, list):
        fail(f'{name} must be a list of [x, y] points')
    if len(raw) > max_points:
        fail(f'{name} has {len(raw)} points; the limit is {max_points}')
    pts = []
    for i, p in enumerate(raw):
        if not isinstance(p, (list, tuple)) or len(p) != 2:
            fail(f'{name} point {i} must be [x, y]')
        pts.append((num(p[0], f'{name} point {i} x'), num(p[1], f'{name} point {i} y')))
    return pts


def signed_area(poly):
    s = 0.0
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        s += x1 * y2 - x2 * y1
    return s / 2


def cross(o, a, b):
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])


def clean_polygon(poly, eps=1e-6):
    """Drop repeated closing/consecutive points and exactly collinear vertices."""
    out = []
    for p in poly:
        if not out or abs(p[0] - out[-1][0]) > eps or abs(p[1] - out[-1][1]) > eps:
            out.append(p)
    if len(out) > 1 and abs(out[0][0] - out[-1][0]) <= eps and abs(out[0][1] - out[-1][1]) <= eps:
        out.pop()
    changed = True
    while changed and len(out) >= 3:
        changed = False
        for i in range(len(out)):
            a, b, c = out[i - 1], out[i], out[(i + 1) % len(out)]
            span = math.hypot(c[0] - a[0], c[1] - a[1]) or 1.0
            if abs(cross(a, b, c)) / span <= eps:
                del out[i]
                changed = True
                break
    return out


def bbox(poly):
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    return min(xs), min(ys), max(xs), max(ys)


def _segments_intersect(p1, p2, p3, p4, eps=1e-9):
    d1, d2 = cross(p3, p4, p1), cross(p3, p4, p2)
    d3, d4 = cross(p1, p2, p3), cross(p1, p2, p4)
    if ((d1 > eps and d2 < -eps) or (d1 < -eps and d2 > eps)) and ((d3 > eps and d4 < -eps) or (d3 < -eps and d4 > eps)):
        return True

    def on_seg(a, b, c):
        return min(a[0], b[0]) - eps <= c[0] <= max(a[0], b[0]) + eps and min(a[1], b[1]) - eps <= c[1] <= max(a[1], b[1]) + eps

    if abs(d1) <= eps and on_seg(p3, p4, p1):
        return True
    if abs(d2) <= eps and on_seg(p3, p4, p2):
        return True
    if abs(d3) <= eps and on_seg(p1, p2, p3):
        return True
    if abs(d4) <= eps and on_seg(p1, p2, p4):
        return True
    return False


def is_simple(poly):
    n = len(poly)
    for i in range(n):
        a1, a2 = poly[i], poly[(i + 1) % n]
        for j in range(i + 1, n):
            if j == i or (j + 1) % n == i or (i + 1) % n == j:
                continue
            if _segments_intersect(a1, a2, poly[j], poly[(j + 1) % n]):
                return False
    return True


def is_convex(poly):
    sign = 0
    n = len(poly)
    for i in range(n):
        c = cross(poly[i], poly[(i + 1) % n], poly[(i + 2) % n])
        if abs(c) < 1e-12:
            continue
        s = 1 if c > 0 else -1
        if sign and s != sign:
            return False
        sign = s
    return True


def point_in_polygon(pt, poly):
    x, y = pt
    inside = False
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            xi = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if xi > x:
                inside = not inside
    return inside


def _in_tri_strict(p, a, b, c, eps=1e-12):
    return cross(a, b, p) > eps and cross(b, c, p) > eps and cross(c, a, p) > eps


def _in_tri_closed(p, a, b, c, eps=1e-12):
    return cross(a, b, p) >= -eps and cross(b, c, p) >= -eps and cross(c, a, p) >= -eps


def _on_open_segment(p, a, b, eps=1e-12):
    if abs(cross(a, b, p)) > eps * max(1.0, math.hypot(b[0] - a[0], b[1] - a[1])):
        return False
    d = (p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])
    return 0 < d < (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2


def ear_clip(pts, idx):
    """Triangulate a CCW (possibly hole-bridged) polygon given as an index list into pts."""
    idx = list(idx)
    tris = []
    guard = 0
    while len(idx) > 3:
        guard += 1
        if guard > 4 * len(pts) * len(pts) + 1000:
            fail('Polygon triangulation did not converge; the outline is probably self-intersecting')
        found = False
        n = len(idx)
        for k in range(n):
            ia, ib, ic = idx[k - 1], idx[k], idx[(k + 1) % n]
            a, b, c = pts[ia], pts[ib], pts[ic]
            if cross(a, b, c) <= 1e-12:
                continue
            blocked = False
            for j in idx:
                if j in (ia, ib, ic):
                    continue
                p = pts[j]
                if p in (a, b, c):  # bridge duplicates share coordinates
                    continue
                if _in_tri_strict(p, a, b, c) or _on_open_segment(p, c, a):
                    blocked = True
                    break
            if blocked:
                continue
            tris.append((ia, ib, ic))
            del idx[k]
            found = True
            break
        if not found:
            # Remove zero-area spikes left by bridging, otherwise give up.
            for k in range(len(idx)):
                a, b, c = pts[idx[k - 1]], pts[idx[k]], pts[idx[(k + 1) % len(idx)]]
                if abs(cross(a, b, c)) <= 1e-12:
                    del idx[k]
                    found = True
                    break
        if not found:
            fail('Could not triangulate polygon; it is likely self-intersecting or degenerate')
    if len(idx) == 3 and cross(pts[idx[0]], pts[idx[1]], pts[idx[2]]) > 1e-12:
        tris.append(tuple(idx))
    return tris


def _wedge_occurrence(pts, ring, v, default_k, target):
    """A bridge vertex may appear several times in the ring; use the copy whose interior wedge faces target."""
    occ = [k for k, x in enumerate(ring) if x == v]
    if len(occ) < 2:
        return default_k
    c = pts[v]
    for k in occ:
        a, b = pts[ring[k - 1]], pts[ring[(k + 1) % len(ring)]]
        # interior is to the left of the CCW ring: wedge from direction (c->b) counter-clockwise to (c->a)
        convex = cross(a, c, b) > 0
        left_of_out = cross(c, b, target) > 0
        left_of_in = cross(a, c, target) > 0
        if (convex and left_of_out and left_of_in) or (not convex and (left_of_out or left_of_in)):
            return k
    return default_k


def triangulate_with_holes(outer, holes):
    """Return (points, triangles) for a CCW outer loop with CW hole loops (bridging + ear clipping).

    Points are ordered outer first, then each hole, so callers can map indices to loop vertices.
    """
    pts = list(outer)
    loops = []
    start = len(pts)
    for h in holes:
        loops.append(list(range(start, start + len(h))))
        pts.extend(h)
        start += len(h)
    ring = list(range(len(outer)))
    for loop in sorted(loops, key=lambda L: -max(pts[i][0] for i in L)):
        m_pos = max(range(len(loop)), key=lambda k: (pts[loop[k]][0], -pts[loop[k]][1]))
        m = loop[m_pos]
        mx, my = pts[m]
        best = None
        for k in range(len(ring)):
            a, b = pts[ring[k]], pts[ring[(k + 1) % len(ring)]]
            if (a[1] > my) == (b[1] > my) and not (a[1] == my or b[1] == my):
                continue
            if a[1] == b[1]:
                continue
            t = (my - a[1]) / (b[1] - a[1])
            if t < -1e-12 or t > 1 + 1e-12:
                continue
            x = a[0] + t * (b[0] - a[0])
            if x < mx - 1e-12:
                continue
            if best is None or x < best[0]:
                best = (x, k)
        if best is None:
            fail('Mounting opening is not inside the panel outline')
        ix, k = best
        i_pt = (ix, my)
        ka, kb = k, (k + 1) % len(ring)
        pa, pb = pts[ring[ka]], pts[ring[kb]]
        if abs(pa[0] - pb[0]) <= 1e-12:
            cand_k = ka if abs(pa[1] - my) <= abs(pb[1] - my) else kb
        else:
            cand_k = ka if pa[0] > pb[0] else kb
        cand = ring[cand_k]
        p = pts[cand]
        # A reflex ring vertex inside triangle (M, I, P) would block the bridge.
        blockers = []
        for kk, v in enumerate(ring):
            if v == cand:
                continue
            vp = pts[v]
            prev, nxt = pts[ring[kk - 1]], pts[ring[(kk + 1) % len(ring)]]
            tri = ((mx, my), i_pt, p) if cross((mx, my), i_pt, p) > 0 else ((mx, my), p, i_pt)
            if cross(prev, vp, nxt) < 0 and _in_tri_closed(vp, *tri):
                blockers.append((abs(math.atan2(vp[1] - my, vp[0] - mx)), math.hypot(vp[0] - mx, vp[1] - my), kk))
        if blockers:
            cand_k = min(blockers)[2]
            cand = ring[cand_k]
        cand_k = _wedge_occurrence(pts, ring, cand, cand_k, (mx, my))
        hole_seq = loop[m_pos:] + loop[:m_pos] + [m]
        ring = ring[:cand_k + 1] + hole_seq + [cand] + ring[cand_k + 1:]
    return pts, ear_clip(pts, ring)


def triangle_area(a, b, c):
    return cross(a, b, c) / 2


def clip_convex(subject, clip):
    """Sutherland–Hodgman: subject ∩ clip, both CCW convex."""
    out = list(subject)
    n = len(clip)
    for i in range(n):
        a, b = clip[i], clip[(i + 1) % n]
        inp, out = out, []
        if not inp:
            break
        s = inp[-1]
        for e in inp:
            ein, sin = cross(a, b, e) >= 0, cross(a, b, s) >= 0
            if ein:
                if not sin:
                    out.append(_line_hit(s, e, a, b))
                out.append(e)
            elif sin:
                out.append(_line_hit(s, e, a, b))
            s = e
    return out


def _line_hit(p1, p2, a, b):
    d1 = cross(a, b, p1)
    d2 = cross(a, b, p2)
    t = d1 / (d1 - d2) if d1 != d2 else 0.0
    return (p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t)


def rounded_rect(cx, cy, w, h, r, per_quarter=8):
    """Same opening shape as Surface Lab's core.geometry(): a rectangle with corner radius r."""
    r = max(0.0, min(r, w / 2, h / 2))
    if r <= 1e-9:
        return [(cx - w / 2, cy - h / 2), (cx + w / 2, cy - h / 2), (cx + w / 2, cy + h / 2), (cx - w / 2, cy + h / 2)]
    corners = [(cx + w / 2 - r, cy - h / 2 + r, -math.pi / 2), (cx + w / 2 - r, cy + h / 2 - r, 0.0),
               (cx - w / 2 + r, cy + h / 2 - r, math.pi / 2), (cx - w / 2 + r, cy - h / 2 + r, math.pi)]
    pts = []
    for ox, oy, a0 in corners:
        for i in range(per_quarter + 1):
            a = a0 + (math.pi / 2) * i / per_quarter
            pts.append((ox + r * math.cos(a), oy + r * math.sin(a)))
    return clean_polygon(pts, 1e-9)


# --------------------------------------------------------------------------- meshes

def extrude(outer, holes, z0, z1):
    """Closed, outward-oriented triangle mesh of an outline (CCW) with holes (CW) between z0 and z1."""
    pts, tris = triangulate_with_holes(outer, holes)
    n = len(pts)
    verts = [(x, y, z0) for x, y in pts] + [(x, y, z1) for x, y in pts]
    faces = []
    for a, b, c in tris:
        faces.append((a, c, b))
        faces.append((a + n, b + n, c + n))
    start = 0
    for loop in [outer] + list(holes):
        m = len(loop)
        for i in range(m):
            a, b = start + i, start + (i + 1) % m
            faces.append((a, b, b + n))
            faces.append((a, b + n, a + n))
        start += m
    return verts, faces, tris, pts


def mesh_report(verts, faces):
    """Topology + volume. Closed oriented 2-manifold ⇔ each directed edge once, its reverse once."""
    edges = {}
    for f in faces:
        if len(set(f)) != 3:
            return {'manifold': False, 'reason': 'degenerate triangle'}
        for i in range(3):
            e = (f[i], f[(i + 1) % 3])
            edges[e] = edges.get(e, 0) + 1
    for (a, b), c in edges.items():
        if c != 1 or edges.get((b, a)) != 1:
            return {'manifold': False, 'reason': f'edge {a}-{b} is not shared by exactly two consistently oriented triangles'}
    vol = 0.0
    for a, b, c in faces:
        (x1, y1, z1), (x2, y2, z2), (x3, y3, z3) = verts[a], verts[b], verts[c]
        vol += (x1 * (y2 * z3 - y3 * z2) - x2 * (y1 * z3 - y3 * z1) + x3 * (y1 * z2 - y2 * z1)) / 6
    used = {i for f in faces for i in f}
    euler = len(used) - len(edges) // 2 + len(faces)
    return {'manifold': True, 'volume': vol, 'euler': euler, 'vertices': len(used), 'triangles': len(faces)}


# --------------------------------------------------------------------------- template

def read_zip(path):
    try:
        with ZipFile(path) as z:
            bad = z.testzip()
            if bad:
                fail(f'Corrupt ZIP member: {bad}')
            data = {}
            for info in z.infolist():
                if info.is_dir():
                    continue
                name = info.filename
                pp = PurePosixPath(name)
                if name.startswith('/') or '..' in pp.parts or '\\' in name:
                    fail(f'Unsafe archive member name: {name!r}')
                data[name] = z.read(name)
            return data
    except BadZipFile:
        fail('File is not a valid ZIP/3MF archive')
    except FileNotFoundError:
        fail('Template file was not found')


def write_zip(data, path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, suffix='.tmp', delete=False) as f:
        tmp = Path(f.name)
    try:
        with ZipFile(tmp, 'w', ZIP_DEFLATED) as z:
            for name in ([CONTENT_TYPES] + sorted(n for n in data if n != CONTENT_TYPES)):
                if name in data:
                    z.writestr(name, data[name])
        tmp.replace(path)
    finally:
        tmp.unlink(missing_ok=True)


def parse_area(value, name):
    """Bambu stores areas as ['0x0','350x0',...] or a single comma-joined string."""
    if isinstance(value, str):
        value = value.split(',')
    pts = []
    for p in value or []:
        p = p.strip()
        if not p:
            continue
        m = re.fullmatch(r'(-?[\d.]+)x(-?[\d.]+)', p)
        if not m:
            fail(f'Template {name} has an unexpected point {p!r}')
        pts.append((float(m.group(1)), float(m.group(2))))
    return pts


def first_float(value, name):
    if isinstance(value, list):
        value = value[0] if value else None
    try:
        v = float(str(value).rstrip('%'))
    except (TypeError, ValueError):
        fail(f'Template setting {name} is missing or not numeric')
    return v


def load_template(path):
    data = read_zip(path)
    for required in (MODEL, SETTINGS, OBJECTS, CONTENT_TYPES, ROOT_RELS):
        if required not in data:
            fail(f'Template is missing {required}')
    try:
        settings = json.loads(data[SETTINGS])
    except json.JSONDecodeError:
        fail('Template project_settings.config is not valid JSON')
    return data, settings


def template_profile(settings):
    """Printer/process facts the generator relies on, derived from the template only."""
    bed = parse_area(settings.get('printable_area'), 'printable_area')
    if len(bed) < 3:
        fail('Template has no printable_area')
    areas = [bbox(bed)]
    for i, a in enumerate(settings.get('extruder_printable_area') or []):
        pts = parse_area(a, f'extruder_printable_area[{i}]')
        if len(pts) >= 3:
            areas.append(bbox(pts))
    common = (max(a[0] for a in areas), max(a[1] for a in areas), min(a[2] for a in areas), min(a[3] for a in areas))
    if common[2] <= common[0] or common[3] <= common[1]:
        fail('Template printable areas do not overlap')
    excludes = []
    for key in ('wrapping_exclude_area', 'bed_exclude_area'):
        pts = parse_area(settings.get(key), key)
        if len(pts) >= 3:
            excludes.append({'key': key, 'bbox': bbox(pts)})
    first = first_float(settings.get('initial_layer_print_height'), 'initial_layer_print_height')
    layer = first_float(settings.get('layer_height'), 'layer_height')
    if not (0.04 <= first <= 1.0 and 0.04 <= layer <= 1.0):
        fail('Template layer heights are outside a plausible range')
    modifier_top = round(first + layer / 4, 4)
    # Studio slices each layer at its mid-height: layer 1 at first/2, layer 2 at first + layer/2.
    # The modifier must contain the first slice plane and stay below the second.
    lower, upper = first / 2, first + layer / 2
    if not (lower < modifier_top < upper):
        fail('Could not derive a first-layer-only modifier height from the template layer settings')
    return {
        'printer_model': settings.get('printer_model'),
        'printer_profile': settings.get('printer_settings_id'),
        'process_profile': settings.get('print_settings_id'),
        'nozzle_diameter': settings.get('nozzle_diameter'),
        'filament_profiles': settings.get('filament_settings_id'),
        'bed_type': settings.get('curr_bed_type'),
        'layer_height_mm': layer,
        'initial_layer_height_mm': first,
        'modifier_top_mm': modifier_top,
        'modifier_slice_window_mm': [lower, upper],
        'printable_height_mm': first_float(settings.get('printable_height'), 'printable_height'),
        'common_area': common,
        'excludes': excludes,
        'bottom_surface_pattern': settings.get('bottom_surface_pattern'),
        'infill_direction': settings.get('infill_direction'),
    }


def check_empty_template(data):
    root = ET.fromstring(data[MODEL])
    resources, build_el = root.find(q('resources')), root.find(q('build'))
    if resources is None or build_el is None or len(resources) or len(build_el):
        fail('Template must be an empty saved project (no objects or build items)')
    conf = ET.fromstring(data[OBJECTS])
    plates = conf.findall('plate')
    if len(plates) != 1 or conf.findall('object') or plates[0].findall('model_instance'):
        fail('Template model settings must contain exactly one empty plate')
    assemble = conf.find('assemble')
    if assemble is not None and len(assemble):
        fail('Template assembly is not empty')
    return root, conf


def clear_generated(data):
    """Remove toolpaths, slice caches and empty-plate previews; drop references to removed members."""
    removed = set()
    for n in list(data):
        leaf = PurePosixPath(n).name.lower()
        if (re.search(r'\.(?:gcode|bgcode)(?:\.md5)?$', leaf) or n in CACHE_MEMBERS
                or re.match(r'Metadata/(?:slicedata|slice_data)/', n, re.I)
                or re.match(r'Metadata/(?:plate_\d+(?:_small)?|plate_no_light_\d+|top_\d+|pick_\d+|plate_\d+_pattern|plate_\d+_bbox)\.(?:png|jpe?g|json)$', n, re.I)):
            removed.add(n)
            del data[n]
    for n in [m for m in data if m.endswith('.rels')]:
        root = ET.fromstring(data[n])
        changed = False
        for rel in list(root):
            if relationship_target(n, rel.get('Target', '')) in removed:
                root.remove(rel)
                changed = True
        if changed:
            data[n] = xml_bytes(root)
    return sorted(removed)


def relationship_target(rels_path, target):
    """Resolve an OPC Target against the source part's directory, not the .rels file."""
    p = PurePosixPath(rels_path)
    base = PurePosixPath(*p.parent.parent.parts) if p.parent.name == '_rels' else p.parent
    if target.startswith('/'):
        resolved = PurePosixPath(target.lstrip('/'))
    else:
        resolved = base / target
    parts = []
    for part in resolved.parts:
        if part == '..':
            if parts:
                parts.pop()
        elif part not in ('.', ''):
            parts.append(part)
    return '/'.join(parts)


# --------------------------------------------------------------------------- recipe

def validate_recipe(recipe):
    """Check the browser contract. Returns normalized geometry in finished-face coordinates."""
    if not isinstance(recipe, dict):
        fail('Recipe must be a JSON object')
    if recipe.get('schema') != RECIPE_SCHEMA:
        fail(f'Recipe schema must be {RECIPE_SCHEMA}')
    if recipe.get('units', 'mm') != 'mm':
        fail('Recipe units must be mm')
    panel, art = recipe.get('panel'), recipe.get('artwork')
    if not isinstance(panel, dict) or not isinstance(art, dict):
        fail('Recipe needs panel and artwork objects')
    if recipe.get('reference'):
        fail('Imported images are preview-only and cannot become a 3MF yet.')
    if art.get('kind') != 'regional':
        fail('This pattern has no printable regional geometry yet. Choose a Directional regions pattern.')
    comp = art.get('composition') or {}
    if isinstance(comp, dict) and comp.get('mode') == 'overlay':
        fail('Overlay compositions are artwork-only and cannot become overlapping modifiers safely.')
    warnings = []

    w, h = num(panel.get('width'), 'panel width'), num(panel.get('height'), 'panel height')
    t = num(panel.get('studyThickness', 2), 'panel thickness')
    lo, hi = LIMITS['thickness_mm']
    if not (1 <= w <= LIMITS['panel_max_mm'] and 1 <= h <= LIMITS['panel_max_mm']):
        fail(f'Panel size {w:.2f} × {h:.2f} mm is outside the supported 1–{LIMITS["panel_max_mm"]:.0f} mm range')
    if not (lo <= t <= hi):
        fail(f'Panel thickness {t} mm is outside the supported {lo}–{hi} mm range')

    if panel.get('outer') is None:
        outer = [(0.0, 0.0), (w, 0.0), (w, h), (0.0, h)]
        warnings.append('Recipe has no panel outline; using its rectangular width × height.')
    else:
        outer = clean_polygon(point_list(panel['outer'], 'panel outline', LIMITS['max_outer_vertices']))
    if len(outer) >= 4 and not is_simple(outer):
        fail('Panel outline is self-intersecting')
    if len(outer) < 3 or abs(signed_area(outer)) < 1:
        fail('Panel outline is degenerate')
    ob = bbox(outer)
    if abs(ob[0]) > TOL or abs(ob[1]) > TOL or abs(ob[2] - w) > TOL or abs(ob[3] - h) > TOL:
        fail('Panel outline does not match the panel width and height')

    raw_holes = panel.get('holes') or []
    if not isinstance(raw_holes, list) or len(raw_holes) > LIMITS['max_holes']:
        fail('Panel mounting openings are malformed or too many')
    holes = []
    for i, hole in enumerate(raw_holes, 1):
        if not isinstance(hole, dict):
            fail(f'Mounting opening {i} is malformed')
        cx, cy = num(hole.get('x'), f'opening {i} x'), num(hole.get('y'), f'opening {i} y')
        hw = num(hole.get('width', hole.get('diameter')), f'opening {i} width')
        hh = num(hole.get('height', hole.get('diameter', hw)), f'opening {i} height')
        r = num(hole.get('radius', min(hw, hh) / 2), f'opening {i} radius')
        if not (0.5 <= hw <= 40 and 0.5 <= hh <= 40 and 0 <= r <= min(hw, hh) / 2 + TOL):
            fail(f'Mounting opening {i} has implausible dimensions')
        poly = rounded_rect(cx, cy, hw, hh, r)
        if not all(point_in_polygon(p, outer) for p in poly):
            fail(f'Mounting opening {i} is not fully inside the panel outline')
        holes.append({'index': i, 'type': hole.get('type', 'slot'), 'x': cx, 'y': cy, 'width': hw, 'height': hh, 'radius': r, 'polygon': poly, 'bbox': bbox(poly)})
    for a in range(len(holes)):
        for b in range(a + 1, len(holes)):
            A, B = holes[a]['bbox'], holes[b]['bbox']
            if A[0] < B[2] and B[0] < A[2] and A[1] < B[3] and B[1] < A[3]:
                fail(f'Mounting openings {a + 1} and {b + 1} overlap')

    rect = art.get('rectangle')
    if not isinstance(rect, dict):
        fail('Artwork rectangle is missing')
    rx, ry, rw, rh = (num(rect.get(k), f'artwork rectangle {k}') for k in ('x', 'y', 'width', 'height'))
    if rw <= 0 or rh <= 0:
        fail('Artwork rectangle must have positive size')
    if rx < -TOL or ry < -TOL or rx + rw > w + TOL or ry + rh > h + TOL:
        fail('Artwork rectangle extends outside the panel')
    rect_poly = [(rx, ry), (rx + rw, ry), (rx + rw, ry + rh), (rx, ry + rh)]
    for hole in holes:
        B = hole['bbox']
        if B[0] < rx + rw and rx < B[2] and B[1] < ry + rh and ry < B[3]:
            fail(f'Artwork rectangle overlaps mounting opening {hole["index"]}; increase the end zone')

    raw_regions = art.get('regions')
    if not isinstance(raw_regions, list) or not raw_regions:
        fail('Regional pattern has no regions')
    if len(raw_regions) > LIMITS['max_regions']:
        fail(f'Pattern has {len(raw_regions)} regions; the limit is {LIMITS["max_regions"]}. Increase the pattern scale.')
    regions, total_vertices, skipped, tiny = [], 0, 0, 0
    for i, r in enumerate(raw_regions):
        if not isinstance(r, dict):
            fail(f'Region {i} is malformed')
        poly = clean_polygon(point_list(r.get('polygon'), f'region {i} polygon', LIMITS['max_region_vertices']))
        angle = num(r.get('angle', 0), f'region {i} angle')
        if len(poly) >= 4 and not is_simple(poly):
            fail(f'Region {i} polygon is self-intersecting')
        if len(poly) < 3 or abs(signed_area(poly)) < LIMITS['min_region_area_mm2']:
            skipped += 1
            continue
        if signed_area(poly) < 0:
            poly.reverse()
        b = bbox(poly)
        if b[0] < rx - TOL or b[1] < ry - TOL or b[2] > rx + rw + TOL or b[3] > ry + rh + TOL:
            fail(f'Region {i} extends outside the artwork rectangle')
        poly = clean_polygon([(min(max(x, rx), rx + rw), min(max(y, ry), ry + rh)) for x, y in poly])
        if len(poly) < 3 or abs(signed_area(poly)) < LIMITS['min_region_area_mm2']:
            skipped += 1
            continue
        area = abs(signed_area(poly))
        if area < LIMITS['tiny_region_area_mm2']:
            tiny += 1
        total_vertices += len(poly)
        regions.append({'source_index': i, 'polygon': poly, 'angle': angle % 180.0, 'area': area, 'bbox': bbox(poly)})
    if total_vertices > LIMITS['max_total_vertices']:
        fail('Pattern is too complex for a modifier project; increase the pattern scale')
    if not regions:
        fail('All regions are degenerate')
    if skipped:
        warnings.append(f'{skipped} degenerate region(s) with zero area were skipped.')
    if tiny:
        warnings.append(f'{tiny} region(s) are smaller than {LIMITS["tiny_region_area_mm2"]} mm² and may vanish after perimeters.')

    # Overlap: exact intersection area over triangulations, bbox-prefiltered.
    for r in regions:
        r['tris'] = [tuple(r['polygon'][k] for k in tri) for tri in ear_clip(r['polygon'], range(len(r['polygon'])))]
        tri_area = sum(triangle_area(*t) for t in r['tris'])
        if abs(tri_area - r['area']) > max(1e-6, r['area'] * 1e-6):
            fail(f'Region {r["source_index"]} could not be triangulated cleanly')
    order = sorted(range(len(regions)), key=lambda k: regions[k]['bbox'][0])
    overlap_total = 0.0
    for oi, a in enumerate(order):
        A = regions[a]
        for b in order[oi + 1:]:
            B = regions[b]
            if B['bbox'][0] >= A['bbox'][2] - 1e-9:
                break
            if B['bbox'][1] >= A['bbox'][3] - 1e-9 or A['bbox'][1] >= B['bbox'][3] - 1e-9:
                continue
            ov = 0.0
            for ta in A['tris']:
                for tb in B['tris']:
                    inter = clip_convex(list(ta), list(tb))
                    if len(inter) >= 3:
                        ov += abs(signed_area(inter))
            if ov > 1e-3:
                fail(f'Regions {A["source_index"]} and {B["source_index"]} overlap by {ov:.3f} mm²; modifiers must not overlap')
            overlap_total += ov
    covered = sum(r['area'] for r in regions)
    coverage = covered / (rw * rh)
    if coverage > 1 + 1e-4:
        fail('Region areas exceed the artwork rectangle')
    if coverage < LIMITS['coverage_warn']:
        warnings.append(f'Regions cover {coverage * 100:.1f}% of the artwork rectangle; uncovered parts print with the plain 45° treatment.')

    plain = ((recipe.get('manufacturing') or {}).get('plainZones') or {})
    plain_pattern = plain.get('pattern', 'monotonic')
    plain_angle = num(plain.get('angle', 45), 'plain zone angle') % 180.0
    if plain_pattern not in SURFACE_PATTERNS:
        fail(f'Unsupported plain-zone pattern {plain_pattern!r}')

    return {
        'panel': {'id': panel.get('id'), 'hp': panel.get('hp'), 'width': w, 'height': h, 'thickness': t, 'outer': outer, 'holes': holes},
        'rectangle': {'x': rx, 'y': ry, 'width': rw, 'height': rh, 'polygon': rect_poly},
        'pattern': {'id': art.get('patternId'), 'name': art.get('name'), 'composition': comp.get('mode', 'single') if isinstance(comp, dict) else 'single'},
        'regions': regions,
        'coverage': coverage,
        'plain': {'pattern': plain_pattern, 'angle': plain_angle},
        'warnings': warnings,
    }


def to_bed(pt, w, h):
    """Finished-face (top-left, Y down) → part-local bed coordinates for face-down printing."""
    x, y = pt
    if FACE_DOWN_MIRROR == 'x':
        return (w - x, h - y)
    return (x, y)


def bed_loop(poly, w, h, ccw=True):
    out = [to_bed(p, w, h) for p in poly]
    if (signed_area(out) > 0) != ccw:
        out.reverse()
    return out


def bed_angle(angle, offset):
    # Linear part of to_bed is -I (mirror 'x') or a Y-down→Y-up flip ('none').
    a = angle if FACE_DOWN_MIRROR == 'x' else -angle
    # Round before wrapping so values like 179.9999999999 become 0, never 180.
    return round(((a + offset) % 180.0 + 180.0) % 180.0, 6) % 180.0


# --------------------------------------------------------------------------- build

def add_mesh(resources, oid, vertices, triangles):
    obj = ET.SubElement(resources, q('object'), {'id': str(oid), 'type': 'model', f'{{{PROD}}}UUID': str(uuid.uuid4())})
    mesh = ET.SubElement(obj, q('mesh'))
    vs = ET.SubElement(mesh, q('vertices'))
    ts = ET.SubElement(mesh, q('triangles'))
    for v in vertices:
        ET.SubElement(vs, q('vertex'), {'x': fmt(v[0]), 'y': fmt(v[1]), 'z': fmt(v[2])})
    for t in triangles:
        ET.SubElement(ts, q('triangle'), {'v1': str(t[0]), 'v2': str(t[1]), 'v3': str(t[2])})


def meta(parent, key, value):
    ET.SubElement(parent, 'metadata', {'key': str(key), 'value': str(value)})


def build(recipe, template, output, angle_offset=ANGLE_OFFSET_DEG):
    geo = validate_recipe(recipe)
    data, settings = load_template(template)
    template_settings_hash = sha256(data[SETTINGS])
    profile = template_profile(settings)
    root, conf = check_empty_template(data)
    for key in PART_SETTING_KEYS:
        if key not in settings:
            fail(f'Template does not define {key}; this Bambu Studio version may use different setting names')

    p = geo['panel']
    w, h, t = p['width'], p['height'], p['thickness']
    if t > profile['printable_height_mm']:
        fail('Panel is taller than the printable height')
    area = profile['common_area']
    cx, cy = (area[0] + area[2]) / 2, (area[1] + area[3]) / 2
    x0, y0 = cx - w / 2, cy - h / 2
    footprint = (x0, y0, x0 + w, y0 + h)
    if footprint[0] < area[0] - TOL or footprint[1] < area[1] - TOL or footprint[2] > area[2] + TOL or footprint[3] > area[3] + TOL:
        fail('Panel does not fit inside the printable area shared by both nozzles')
    for ex in profile['excludes']:
        b = ex['bbox']
        if footprint[0] < b[2] and b[0] < footprint[2] and footprint[1] < b[3] and b[1] < footprint[3]:
            fail(f'Panel footprint overlaps the template {ex["key"]}')

    modifier_top = profile['modifier_top_mm']
    resources, build_el = root.find(q('resources')), root.find(q('build'))
    parts = []
    next_id = 1

    outer_bed = bed_loop(p['outer'], w, h, ccw=True)
    holes_bed = [bed_loop(hh['polygon'], w, h, ccw=False) for hh in p['holes']]
    verts, faces, tris, flat_pts = extrude(outer_bed, holes_bed, 0.0, t)
    expected_area = abs(signed_area(outer_bed)) - sum(abs(signed_area(hb)) for hb in holes_bed)
    tri_area = sum(triangle_area(flat_pts[a], flat_pts[b], flat_pts[c]) for a, b, c in tris)
    if abs(tri_area - expected_area) > 1e-4 * max(1.0, expected_area):
        fail('Panel outline with mounting openings could not be triangulated exactly')
    rep = mesh_report(verts, faces)
    if not rep['manifold'] or abs(rep['volume'] - expected_area * t) > 1e-3 * expected_area * t:
        fail('Panel body mesh is not a closed solid')
    add_mesh(resources, next_id, verts, faces)
    body_settings = {'bottom_surface_pattern': geo['plain']['pattern'], 'infill_direction': fmt(bed_angle(geo['plain']['angle'], angle_offset))}
    parts.append({'id': next_id, 'name': 'Panel', 'subtype': 'normal_part', 'settings': body_settings, 'role': 'body'})
    next_id += 1

    for k, r in enumerate(geo['regions'], 1):
        loop = bed_loop(r['polygon'], w, h, ccw=True)
        mv, mf, _, _ = extrude(loop, [], 0.0, modifier_top)
        mr = mesh_report(mv, mf)
        if not mr['manifold'] or mr['volume'] <= 0:
            fail(f'Modifier mesh for region {r["source_index"]} is not closed')
        add_mesh(resources, next_id, mv, mf)
        angle = bed_angle(r['angle'], angle_offset)
        parts.append({'id': next_id, 'name': f'Pattern region {k} ({fmt(round(angle, 3))}°)', 'subtype': 'modifier_part',
                      'settings': {'bottom_surface_pattern': 'alignedrectilinear', 'bottom_surface_density': '100%', 'infill_direction': fmt(angle)},
                      'role': 'region', 'source_index': r['source_index'], 'recipe_angle': r['angle']})
        next_id += 1

    for part in parts:
        if part['subtype'] not in PART_SUBTYPES:
            fail(f'Internal error: unknown subtype {part["subtype"]}')
        for key, value in part['settings'].items():
            if key not in PART_SETTING_KEYS:
                fail(f'Internal error: unsupported part setting {key}')
        if part['settings']['bottom_surface_pattern'] not in SURFACE_PATTERNS:
            fail('Internal error: unsupported surface pattern')

    wrapper_id = next_id
    wrapper = ET.SubElement(resources, q('object'), {'id': str(wrapper_id), 'type': 'model', f'{{{PROD}}}UUID': str(uuid.uuid4())})
    comps = ET.SubElement(wrapper, q('components'))
    for part in parts:
        ET.SubElement(comps, q('component'), {'objectid': str(part['id']), 'transform': IDENTITY, f'{{{PROD}}}UUID': str(uuid.uuid4())})
    transform = f'1 0 0 0 1 0 0 0 1 {fmt(x0)} {fmt(y0)} 0'
    build_el.set(f'{{{PROD}}}UUID', str(uuid.uuid4()))
    ET.SubElement(build_el, q('item'), {'objectid': str(wrapper_id), 'transform': transform, 'printable': '1', f'{{{PROD}}}UUID': str(uuid.uuid4())})

    label = f"Zudo blank {p['hp'] or '?'}HP — {geo['pattern']['name'] or geo['pattern']['id'] or 'pattern'}"
    ob = ET.Element('object', {'id': str(wrapper_id)})
    conf.insert(0, ob)
    meta(ob, 'name', label)
    meta(ob, 'extruder', '1')
    for part in parts:
        el = ET.SubElement(ob, 'part', {'id': str(part['id']), 'subtype': part['subtype']})
        meta(el, 'name', part['name'])
        meta(el, 'matrix', MATRIX4)
        meta(el, 'extruder', '1')
        for key, value in part['settings'].items():
            meta(el, key, value)
    plate = conf.find('plate')
    for key in PLATE_IMAGE_KEYS:
        for m in list(plate.findall('metadata')):
            if m.get('key') == key:
                plate.remove(m)
    inst = ET.SubElement(plate, 'model_instance')
    meta(inst, 'object_id', wrapper_id)
    meta(inst, 'instance_id', '0')
    meta(inst, 'identify_id', '1')
    assemble = conf.find('assemble')
    if assemble is None:
        assemble = ET.SubElement(conf, 'assemble')
    ET.SubElement(assemble, 'assemble_item', {'object_id': str(wrapper_id), 'instance_id': '0', 'transform': transform, 'offset': '0 0 0'})

    for key, val in [('Title', label), ('Description', 'Generated by zudo-bambu-blanks from a Surface Lab regional recipe. Unsliced; experimental until validated in Bambu Studio.'),
                     ('ModificationDate', date.today().isoformat())]:
        el = next((e for e in root.findall(q('metadata')) if e.get('name') == key), None)
        if el is None:
            el = ET.Element(q('metadata'), {'name': key})
            root.insert(list(root).index(resources), el)
        el.text = val

    removed = clear_generated(data)
    data[MODEL] = xml_bytes(root)
    data[OBJECTS] = xml_bytes(conf)
    assert sha256(data[SETTINGS]) == template_settings_hash
    write_zip(data, output)

    return {
        'status': 'generated_unsliced_project',
        'generator': GENERATOR_VERSION,
        'panel': {'id': p['id'], 'hp': p['hp'], 'width': w, 'height': h, 'thickness': t, 'openings': len(p['holes'])},
        'artwork_rectangle': {k: geo['rectangle'][k] for k in ('x', 'y', 'width', 'height')},
        'pattern': {'id': geo['pattern']['id'], 'name': geo['pattern']['name'], 'composition': geo['pattern']['composition'],
                    'regions': len(geo['regions']), 'coverage': round(geo['coverage'], 5)},
        'modifier_height_mm': modifier_top,
        'transform': {'face_down_mirror': FACE_DOWN_MIRROR, 'angle_offset_deg': angle_offset, 'placement_mm': [round(x0, 4), round(y0, 4)]},
        'template': public_profile(profile),
        'template_settings_sha256': template_settings_hash,
        'removed_template_members': removed,
        'warnings': geo['warnings'],
        'notes': ['Unsliced project; open in Bambu Studio and inspect layers 1 and 2 before printing.',
                  'Face-down mirroring and the infill_direction angle convention are not yet confirmed in Studio (issue #2).'],
    }


def public_profile(profile):
    return {k: profile[k] for k in ('printer_model', 'printer_profile', 'process_profile', 'nozzle_diameter', 'filament_profiles',
                                     'bed_type', 'layer_height_mm', 'initial_layer_height_mm', 'modifier_top_mm')}


# --------------------------------------------------------------------------- validation of a written package

class PointIndex:
    """Tolerant point lookup (mesh coordinates are written with 12 significant digits)."""

    def __init__(self, points, tol=1e-6):
        self.tol, self.step, self.cells = tol, 1e-3, {}
        for pt in points:
            self.cells.setdefault(self._key(pt), []).append(pt)

    def _key(self, pt):
        return tuple(math.floor(c / self.step) for c in pt)

    def __contains__(self, pt):
        k = self._key(pt)
        for off in itertools.product((-1, 0, 1), repeat=len(k)):
            for cand in self.cells.get(tuple(a + b for a, b in zip(k, off)), ()):
                if max(abs(a - b) for a, b in zip(cand, pt)) <= self.tol:
                    return True
        return False


def validate_package(output, recipe, template, angle_offset=ANGLE_OFFSET_DEG):
    """Re-open the written 3MF and check it against the recipe and template. Returns a list of check names."""
    checks = []

    def check(cond, name, msg):
        if not cond:
            fail(f'Validation failed: {msg}')
        checks.append(name)

    geo = validate_recipe(recipe)
    tdata, tsettings = load_template(template)
    profile = template_profile(tsettings)
    data = read_zip(output)
    for m in (MODEL, SETTINGS, OBJECTS, CONTENT_TYPES, ROOT_RELS):
        check(m in data, 'members', f'{m} is missing')

    check(data[SETTINGS] == tdata[SETTINGS], 'template_settings_preserved', 'project_settings.config differs from the template')
    for name, b in tdata.items():
        if name.startswith('Metadata/') and name.endswith('.config') and name not in (OBJECTS, SETTINGS) and name not in CACHE_MEMBERS:
            check(data.get(name) == b, 'template_configs_preserved', f'{name} differs from the template')
    check(not any(re.search(r'\.(?:gcode|bgcode)(?:\.md5)?$', n, re.I) for n in data), 'no_gcode', 'archive contains G-code')
    check(not any(n in CACHE_MEMBERS or re.match(r'Metadata/(?:slicedata|slice_data)/', n, re.I) for n in data), 'no_slice_cache', 'archive contains slice caches')

    ct = ET.fromstring(data[CONTENT_TYPES])
    defaults = {e.get('Extension', '').lower() for e in ct if e.tag == f'{{{CT_NS}}}Default'}
    overrides = {e.get('PartName', '').lstrip('/') for e in ct if e.tag == f'{{{CT_NS}}}Override'}
    def typed(n):
        return n.rsplit('.', 1)[-1].lower() in defaults or n in overrides

    # Bambu's own projects leave Metadata/*.config untyped; OPC parts that are
    # referenced by relationships (model, thumbnails) and .rels must be typed.
    model_rel = False
    for n in [m for m in data if m.endswith('.rels')]:
        check(typed(n), 'content_types', f'no content type for {n}')
        for rel in ET.fromstring(data[n]):
            target = relationship_target(n, rel.get('Target', ''))
            check(target in data, 'relationships', f'{n} references missing {target}')
            check(typed(target), 'content_types', f'no content type for {target}')
            if rel.get('Type', '').endswith('/3dmodel') and target == MODEL:
                model_rel = True
    check(model_rel, 'root_model_relationship', 'root relationship to 3D/3dmodel.model is missing')

    root = ET.fromstring(data[MODEL])
    check(root.get('unit', 'millimeter') == 'millimeter', 'units', 'model unit is not millimeter')
    objects = {o.get('id'): o for o in root.find(q('resources')).findall(q('object'))}
    items = root.find(q('build')).findall(q('item'))
    check(len(items) == 1, 'single_build_item', 'expected exactly one build item')
    wrapper = objects.get(items[0].get('objectid'))
    check(wrapper is not None and wrapper.find(q('components')) is not None, 'wrapper_object', 'build item does not reference a component object')
    comp_ids = [c.get('objectid') for c in wrapper.find(q('components')).findall(q('component'))]
    check(all(cid in objects and objects[cid].find(q('mesh')) is not None for cid in comp_ids), 'component_refs', 'component references a missing mesh object')
    tf = [float(v) for v in items[0].get('transform').split()]
    check(tf[:9] == [1, 0, 0, 0, 1, 0, 0, 0, 1], 'placement_rotation', 'build item must not rotate or scale')
    ox, oy = tf[9], tf[10]

    conf = ET.fromstring(data[OBJECTS])
    cobjs = conf.findall('object')
    check(len(cobjs) == 1 and cobjs[0].get('id') == wrapper.get('id'), 'model_settings_object', 'model_settings object does not match the build item')
    cparts = cobjs[0].findall('part')
    check([pp.get('id') for pp in cparts] == comp_ids, 'model_settings_parts', 'model_settings parts do not match components')
    plate = conf.find('plate')
    check(len(plate.findall('model_instance')) == 1, 'plate_instance', 'plate must contain exactly one instance')
    for m in plate.findall('metadata'):
        if m.get('key') in PLATE_IMAGE_KEYS:
            check(m.get('value', '') in data, 'plate_images', f'plate references missing {m.get("value")}')

    def part_meta(pp):
        return {m.get('key'): m.get('value') for m in pp.findall('metadata')}

    def mesh_of(oid):
        mesh = objects[oid].find(q('mesh'))
        vs = [(float(v.get('x')), float(v.get('y')), float(v.get('z'))) for v in mesh.find(q('vertices'))]
        ts = [(int(t.get('v1')), int(t.get('v2')), int(t.get('v3'))) for t in mesh.find(q('triangles'))]
        check(all(math.isfinite(c) for v in vs for c in v), 'finite_vertices', f'object {oid} has non-finite vertices')
        check(all(0 <= i < len(vs) for t in ts for i in t), 'triangle_indices', f'object {oid} has out-of-range indices')
        return vs, ts

    p = geo['panel']
    w, h, t = p['width'], p['height'], p['thickness']
    subtypes = [pp.get('subtype') for pp in cparts]
    check(all(s in PART_SUBTYPES for s in subtypes), 'subtypes_known', 'unknown part subtype')
    check(subtypes.count('normal_part') == 1, 'single_body', 'expected exactly one normal_part body')
    check(subtypes.count('modifier_part') == len(geo['regions']), 'modifier_count', 'modifier count does not match recipe regions')
    for pp in cparts:
        md = part_meta(pp)
        for key, value in md.items():
            if key in ('name', 'matrix', 'extruder'):
                continue
            check(key in tsettings, 'part_setting_keys', f'part setting {key} is not a template setting')
            if key == 'bottom_surface_pattern':
                check(value in SURFACE_PATTERNS, 'part_setting_values', f'unsupported bottom_surface_pattern {value}')
            if key == 'infill_direction':
                check(0 <= float(value) < 180, 'part_setting_values', 'infill_direction out of range')

    body = cparts[subtypes.index('normal_part')]
    bv, bt = mesh_of(body.get('id'))
    rep = mesh_report(bv, bt)
    check(rep['manifold'], 'body_manifold', f'panel body is not a closed oriented solid ({rep.get("reason")})')
    expected_euler = 2 - 2 * len(p['holes'])
    check(rep['euler'] == expected_euler, 'body_genus', f'panel body has Euler characteristic {rep["euler"]}, expected {expected_euler} for {len(p["holes"])} openings')
    outer_area = abs(signed_area(p['outer']))
    hole_area = sum(abs(signed_area(hh['polygon'])) for hh in p['holes'])
    check(abs(rep['volume'] - (outer_area - hole_area) * t) <= 1e-3 * outer_area * t, 'body_volume', 'panel body volume does not match outline minus openings')
    zs = {round(v[2], 6) for v in bv}
    check(zs == {0.0, round(t, 6)}, 'body_z', 'panel body does not span exactly 0..thickness')
    xs, ys = [v[0] for v in bv], [v[1] for v in bv]
    check(abs(min(xs)) < TOL and abs(min(ys)) < TOL and abs(max(xs) - w) < TOL and abs(max(ys) - h) < TOL, 'body_outline', 'panel body bounds do not match the outline')
    # Every outline and opening vertex must be present at both faces, mapped through the face-down transform.
    bset = PointIndex(bv)
    for poly, label in [(p['outer'], 'outline')] + [(hh['polygon'], f'opening {hh["index"]}') for hh in p['holes']]:
        for pt in poly:
            bx, by = to_bed(pt, w, h)
            for z in (0.0, t):
                check((bx, by, z) in bset, 'contour_vertices', f'{label} vertex {pt} is missing from the body mesh')
    # Openings are true through-holes: no bottom-face triangle covers an opening centre.
    bottom = [tri for tri in bt if all(abs(bv[i][2]) < 1e-9 for i in tri)]
    for hh in p['holes']:
        c = to_bed((hh['x'], hh['y']), w, h)
        covered = any(_in_tri_closed(c, *[(bv[i][0], bv[i][1]) for i in (tri[0], tri[2], tri[1])]) for tri in bottom)
        check(not covered, 'openings_clear', f'opening {hh["index"]} is covered by the body')

    common = profile['common_area']
    check(common[0] - TOL <= ox and ox + w <= common[2] + TOL and common[1] - TOL <= oy and oy + h <= common[3] + TOL, 'bed_bounds', 'object is outside the shared printable area')
    check(t <= profile['printable_height_mm'], 'bed_height', 'object exceeds printable height')

    rect = geo['rectangle']
    rect_bed = bbox([to_bed(pt, w, h) for pt in rect['polygon']])
    mods = [pp for pp in cparts if pp.get('subtype') == 'modifier_part']
    for pp, region in zip(mods, geo['regions']):
        mv, mt = mesh_of(pp.get('id'))
        mr = mesh_report(mv, mt)
        check(mr['manifold'] and mr['volume'] > 0, 'modifier_manifold', f'modifier {pp.get("id")} is not closed')
        top = max(v[2] for v in mv)
        check(min(v[2] for v in mv) == 0 and abs(top - profile['modifier_top_mm']) < 1e-9, 'modifier_height', 'modifier height does not match the template-derived value')
        lo, hi = profile['modifier_slice_window_mm']
        check(lo < top < hi, 'modifier_first_layer_only', 'modifier would affect more than the first layer')
        footprint = [(v[0], v[1]) for v in mv if v[2] == 0]
        expected = [to_bed(pt, w, h) for pt in region['polygon']]
        got, want = PointIndex(footprint), PointIndex(expected)
        check(len(footprint) == len(expected) and all(pt in got for pt in expected) and all(pt in want for pt in footprint), 'region_contract', f'modifier {pp.get("id")} does not match recipe region {region["source_index"]}')
        fb = bbox(footprint)
        check(fb[0] >= rect_bed[0] - TOL and fb[1] >= rect_bed[1] - TOL and fb[2] <= rect_bed[2] + TOL and fb[3] <= rect_bed[3] + TOL, 'region_in_rectangle', 'modifier extends outside the artwork rectangle')
        md = part_meta(pp)
        check(md.get('bottom_surface_pattern') == 'alignedrectilinear', 'modifier_pattern', 'modifier pattern metadata missing')
        check(abs(float(md.get('infill_direction')) - bed_angle(region['angle'], angle_offset)) < 1e-6, 'modifier_angle', f'modifier {pp.get("id")} angle does not match recipe')
    return sorted(set(checks))


# --------------------------------------------------------------------------- inspect / CLI

def inspect(path):
    data = read_zip(path)
    root = ET.fromstring(data[MODEL])
    conf = ET.fromstring(data[OBJECTS])
    settings = json.loads(data[SETTINGS])
    parts = []
    for pp in conf.findall('object/part'):
        md = {m.get('key'): m.get('value') for m in pp.findall('metadata')}
        parts.append({'id': pp.get('id'), 'subtype': pp.get('subtype'), 'name': md.get('name'),
                      'settings': {k: v for k, v in md.items() if k not in ('name', 'matrix', 'extruder')}})
    return {'members': sorted(data), 'build_items': len(root.findall(f'{q("build")}/{q("item")}')), 'parts': parts,
            'printer_model': settings.get('printer_model'), 'nozzle_diameter': settings.get('nozzle_diameter'),
            'contains_toolpaths': any(re.search(r'\.(?:gcode|bgcode)(?:\.md5)?$', n, re.I) for n in data)}


def template_info(path):
    data, settings = load_template(path)
    check_empty_template(data)
    profile = template_profile(settings)
    return {'template_ok': True, 'settings_sha256': sha256(data[SETTINGS]), **public_profile(profile),
            'common_area_mm': profile['common_area']}


def load_recipe(path):
    try:
        text = Path(path).read_text(encoding='utf-8')
    except (OSError, UnicodeDecodeError):
        fail('Recipe file could not be read')
    try:
        return json.loads(text, parse_constant=lambda c: fail(f'Recipe contains non-finite number {c}'))
    except json.JSONDecodeError as e:
        fail(f'Recipe is not valid JSON ({e.msg})')


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest='cmd', required=True)
    g = sub.add_parser('generate')
    g.add_argument('--template', required=True)
    g.add_argument('--recipe', required=True)
    g.add_argument('--output', required=True)
    g.add_argument('--angle-offset', type=float, default=ANGLE_OFFSET_DEG)
    g.add_argument('--no-validate', action='store_true', help='skip the post-write package validation')
    v = sub.add_parser('validate')
    v.add_argument('--template', required=True)
    v.add_argument('--recipe', required=True)
    v.add_argument('--output', required=True)
    v.add_argument('--angle-offset', type=float, default=ANGLE_OFFSET_DEG)
    i = sub.add_parser('inspect')
    i.add_argument('input')
    ti = sub.add_parser('template-info')
    ti.add_argument('template')
    a = ap.parse_args(argv)
    try:
        if a.cmd == 'generate':
            if not math.isfinite(a.angle_offset):
                fail('angle offset must be finite')
            result = build(load_recipe(a.recipe), a.template, a.output, a.angle_offset)
            if not a.no_validate:
                result['validation'] = {'status': 'passed', 'checks': validate_package(a.output, load_recipe(a.recipe), a.template, a.angle_offset)}
        elif a.cmd == 'validate':
            result = {'status': 'passed', 'checks': validate_package(a.output, load_recipe(a.recipe), a.template, a.angle_offset)}
        elif a.cmd == 'inspect':
            result = inspect(a.input)
        else:
            result = template_info(a.template)
        print(json.dumps(result, indent=2))
        return 0
    except RecipeError as e:
        print(json.dumps({'error': str(e), 'kind': 'invalid'}), file=sys.stderr)
        return 2
    except Exception as e:  # noqa: BLE001 - reported to the local UI as an internal failure
        print(json.dumps({'error': f'Internal generator error: {type(e).__name__}: {e}', 'kind': 'internal'}), file=sys.stderr)
        return 3


if __name__ == '__main__':
    sys.exit(main())
