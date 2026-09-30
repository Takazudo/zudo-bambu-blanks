#!/usr/bin/env python3
import json, os, subprocess, tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
template=Path(os.environ.get('BAMBU_TEMPLATE',ROOT/'assets/h2d-empty.3mf'))
recipe=ROOT/'examples/20hp-regional-smoke.recipe.json'
if not template.exists(): raise SystemExit(f'Missing template: {template}')
with tempfile.TemporaryDirectory() as d:
    out=Path(d)/'smoke.3mf'
    gen=subprocess.run(['python3',str(ROOT/'scripts/generate_3mf.py'),'generate','--template',str(template),'--recipe',str(recipe),'--output',str(out)],capture_output=True,text=True)
    if gen.returncode: raise SystemExit(gen.stderr)
    report=json.loads(gen.stdout)
    inspect=subprocess.run(['python3',str(ROOT/'scripts/generate_3mf.py'),'inspect',str(out)],capture_output=True,text=True,check=True)
    details=json.loads(inspect.stdout)
    assert report['pattern']['regions']>0
    assert any(p['subtype']=='negative_part' for p in details['parts'])
    assert any(p['subtype']=='modifier_part' for p in details['parts'])
    assert details['contains_toolpaths'] is False
    print(json.dumps({'status':'ok','regions':report['pattern']['regions'],'parts':len(details['parts']),'printer':details['printer_model']},indent=2))
