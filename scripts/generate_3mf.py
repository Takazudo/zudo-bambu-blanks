#!/usr/bin/env python3
from __future__ import annotations
import argparse, json, math, re, sys, tempfile, uuid
from datetime import date
from pathlib import Path
import xml.etree.ElementTree as ET
from zipfile import ZipFile, ZIP_DEFLATED

CORE='http://schemas.microsoft.com/3dmanufacturing/core/2015/02'
PROD='http://schemas.microsoft.com/3dmanufacturing/production/2015/06'
BBL='http://schemas.bambulab.com/package/2021'
MODEL='3D/3dmodel.model'
SETTINGS='Metadata/project_settings.config'
OBJECTS='Metadata/model_settings.config'
IDENTITY='1 0 0 0 1 0 0 0 1 0 0 0'
MATRIX4='1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1'
ET.register_namespace('', CORE); ET.register_namespace('p', PROD); ET.register_namespace('BambuStudio', BBL)

def q(tag): return f'{{{CORE}}}{tag}'
def fmt(v): return format(float(v), '.12g')
def fail(msg): raise ValueError(msg)
def meta(parent,key,value): ET.SubElement(parent,'metadata',{'key':str(key),'value':str(value)})
def xml_bytes(root):
    ET.indent(root, space='  ')
    return ET.tostring(root, encoding='utf-8', xml_declaration=True)

def read_zip(path):
    with ZipFile(path) as z: return {n:z.read(n) for n in z.namelist() if not n.endswith('/')}
def write_zip(data,path):
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent,suffix='.tmp',delete=False) as f: tmp=Path(f.name)
    try:
        with ZipFile(tmp,'w',ZIP_DEFLATED) as z:
            for n,b in data.items(): z.writestr(n,b)
        tmp.replace(path)
    finally: tmp.unlink(missing_ok=True)

def box_mesh(w,h,z0,z1):
    vs=[(0,0,z0),(w,0,z0),(w,h,z0),(0,h,z0),(0,0,z1),(w,0,z1),(w,h,z1),(0,h,z1)]
    ts=[(0,2,1),(0,3,2),(4,5,6),(4,6,7),(0,1,5),(0,5,4),(1,2,6),(1,6,5),(2,3,7),(2,7,6),(3,0,4),(3,4,7)]
    return vs,ts

def polygon_area(poly):
    return sum(poly[i][0]*poly[(i+1)%len(poly)][1]-poly[(i+1)%len(poly)][0]*poly[i][1] for i in range(len(poly)))/2

def point_in_tri(p,a,b,c):
    def s(p1,p2,p3): return (p1[0]-p3[0])*(p2[1]-p3[1])-(p2[0]-p3[0])*(p1[1]-p3[1])
    d1,d2,d3=s(p,a,b),s(p,b,c),s(p,c,a); neg=d1<0 or d2<0 or d3<0; pos=d1>0 or d2>0 or d3>0
    return not (neg and pos)

def triangulate(poly):
    if len(poly)<3: fail('Region polygon has fewer than 3 points')
    pts=[(float(x),float(y)) for x,y in poly]
    if polygon_area(pts)<0: pts.reverse()
    idx=list(range(len(pts))); tris=[]; guard=0
    while len(idx)>3:
        ear=False
        for k in range(len(idx)):
            a,b,c=idx[k-1],idx[k],idx[(k+1)%len(idx)]
            ax,ay=pts[a]; bx,by=pts[b]; cx,cy=pts[c]
            if (bx-ax)*(cy-ay)-(by-ay)*(cx-ax) <= 1e-10: continue
            if any(point_in_tri(pts[j],pts[a],pts[b],pts[c]) for j in idx if j not in (a,b,c)): continue
            tris.append((a,b,c)); del idx[k]; ear=True; break
        guard+=1
        if not ear or guard>10000: fail('Could not triangulate region polygon; likely self-intersecting')
    tris.append(tuple(idx)); return pts,tris

def prism_mesh(poly,z0,z1):
    pts,top_tris=triangulate(poly); n=len(pts)
    vs=[(x,y,z0) for x,y in pts]+[(x,y,z1) for x,y in pts]
    ts=[]
    for a,b,c in top_tris:
        ts.append((a,c,b)); ts.append((a+n,b+n,c+n))
    for i in range(n):
        j=(i+1)%n; ts.append((i,j,j+n)); ts.append((i,j+n,i+n))
    return vs,ts

def capsule_polygon(cx,cy,w,h,segments=12):
    if abs(w-h)<1e-6:
        r=w/2; return [(cx+math.cos(2*math.pi*i/(segments*2))*r,cy+math.sin(2*math.pi*i/(segments*2))*r) for i in range(segments*2)]
    if w>=h:
        r=h/2; half=max(0,(w-h)/2); pts=[]
        for i in range(segments+1):
            a=-math.pi/2+math.pi*i/segments; pts.append((cx+half+r*math.cos(a),cy+r*math.sin(a)))
        for i in range(segments+1):
            a=math.pi/2+math.pi*i/segments; pts.append((cx-half+r*math.cos(a),cy+r*math.sin(a)))
        return pts
    r=w/2; half=max(0,(h-w)/2); pts=[]
    for i in range(segments+1):
        a=math.pi*i/segments; pts.append((cx+r*math.cos(a),cy+half+r*math.sin(a)))
    for i in range(segments+1):
        a=math.pi+math.pi*i/segments; pts.append((cx+r*math.cos(a),cy-half+r*math.sin(a)))
    return pts

def add_mesh(resources,oid,vertices,triangles):
    obj=ET.SubElement(resources,q('object'),{'id':str(oid),'type':'model',f'{{{PROD}}}UUID':str(uuid.uuid4())})
    mesh=ET.SubElement(obj,q('mesh')); vs=ET.SubElement(mesh,q('vertices')); ts=ET.SubElement(mesh,q('triangles'))
    for v in vertices: ET.SubElement(vs,q('vertex'),{'x':fmt(v[0]),'y':fmt(v[1]),'z':fmt(v[2])})
    for t in triangles: ET.SubElement(ts,q('triangle'),{'v1':str(t[0]),'v2':str(t[1]),'v3':str(t[2])})
    return obj

def clear_cache(data):
    for n in list(data):
        if re.search(r'\.(?:gcode|bgcode)(?:\.|$)',n,re.I) or n in {'Metadata/slice_info.config','Metadata/filament_sequence.json','Metadata/layer_height_profile.txt','Metadata/layer_config_ranges.xml'} or re.match(r'Metadata/(?:plate_\d+(?:_small)?|plate_no_light_\d+|top_\d+|pick_\d+)\.(?:png|jpg|jpeg)$',n,re.I):
            del data[n]

def rect_from_setting(value):
    pts=[]
    for p in value:
        x,y=p.split('x'); pts.append((float(x),float(y)))
    return min(x for x,y in pts),min(y for x,y in pts),max(x for x,y in pts),max(y for x,y in pts)

def build(recipe, template, output):
    if recipe.get('schema')!='zudo-surface-preview/v2': fail('Generator requires zudo-surface-preview/v2 recipe')
    panel=recipe['panel']; art=recipe['artwork']; regions=art.get('regions') or []
    if art.get('kind')!='regional' or not regions: fail('This pattern has no printable regional geometry yet. Choose a Regional pattern.')
    comp=(art.get('composition') or {}).get('mode','single')
    if comp=='overlay': fail('Overlay compositions are artwork-only and cannot become overlapping modifiers safely.')
    w,h,t=float(panel['width']),float(panel['height']),float(panel.get('studyThickness',2))
    if not (0<w<=300 and 0<h<=300 and 0.5<=t<=8): fail('Panel dimensions are outside supported study bounds')
    data=read_zip(template)
    for required in (MODEL,SETTINGS,OBJECTS):
        if required not in data: fail(f'Template missing {required}')
    root=ET.fromstring(data[MODEL]); resources=root.find(q('resources')); build_el=root.find(q('build'))
    if resources is None or build_el is None or len(resources) or len(build_el): fail('Template must be the empty H2D template')
    conf=ET.fromstring(data[OBJECTS]); plate=conf.find('plate')
    if plate is None or conf.findall('object') or plate.findall('model_instance'): fail('Template model settings are not empty')
    assemble=conf.find('assemble')
    if assemble is None: assemble=ET.SubElement(conf,'assemble')
    elif len(assemble): fail('Template assembly is not empty')
    settings=json.loads(data[SETTINGS])
    bed=rect_from_setting(settings['printable_area'])
    x0=(bed[0]+bed[2]-w)/2; y0=(bed[1]+bed[3]-h)/2
    first=float(settings.get('initial_layer_print_height','0.3')); mod_h=first+0.01
    parts=[]; next_id=1
    base_vs,base_ts=box_mesh(w,h,0,t); add_mesh(resources,next_id,base_vs,base_ts); parts.append((next_id,'Panel','normal_part',{'extruder':'1','bottom_surface_pattern':'alignedrectilinear','infill_direction':'45'})); next_id+=1
    for i,hole in enumerate(panel.get('holes',[]),1):
        cx=float(hole['x']); cy=h-float(hole['y']); ww=float(hole.get('width',hole.get('diameter',3.2))); hh=float(hole.get('height',hole.get('diameter',ww)))
        poly=capsule_polygon(cx,cy,ww,hh)
        vs,ts=prism_mesh(poly,-0.2,t+0.4); add_mesh(resources,next_id,vs,ts); parts.append((next_id,f'Mounting cutout {i}','negative_part',{})); next_id+=1
    for i,r in enumerate(regions,1):
        poly=[(float(x),h-float(y)) for x,y in r['polygon']]
        vs,ts=prism_mesh(poly,0,mod_h); add_mesh(resources,next_id,vs,ts)
        angle=(float(r.get('angle',0))%180+180)%180
        parts.append((next_id,f'Pattern region {i}','modifier_part',{'bottom_surface_pattern':'alignedrectilinear','bottom_surface_density':'100%','infill_direction':fmt(angle)})); next_id+=1
    wrapper_id=next_id
    wrapper=ET.SubElement(resources,q('object'),{'id':str(wrapper_id),'type':'model',f'{{{PROD}}}UUID':str(uuid.uuid4())}); comps=ET.SubElement(wrapper,q('components'))
    for pid,_,_,_ in parts: ET.SubElement(comps,q('component'),{'objectid':str(pid),'transform':IDENTITY,f'{{{PROD}}}UUID':str(uuid.uuid4())})
    transform=f'1 0 0 0 1 0 0 0 1 {fmt(x0)} {fmt(y0)} 0'
    build_el.set(f'{{{PROD}}}UUID',str(uuid.uuid4())); ET.SubElement(build_el,q('item'),{'objectid':str(wrapper_id),'transform':transform,'printable':'1',f'{{{PROD}}}UUID':str(uuid.uuid4())})
    ob=ET.Element('object',{'id':str(wrapper_id)}); conf.insert(0,ob); meta(ob,'name',f"Zudo blank {panel.get('hp','?')}HP — {art.get('name',art.get('patternId','pattern'))}"); meta(ob,'extruder','1')
    for pid,name,subtype,overrides in parts:
        part=ET.SubElement(ob,'part',{'id':str(pid),'subtype':subtype}); meta(part,'name',name); meta(part,'matrix',MATRIX4); meta(part,'extruder','1')
        for k,v in overrides.items(): meta(part,k,v)
    inst=ET.SubElement(plate,'model_instance'); meta(inst,'object_id',wrapper_id); meta(inst,'instance_id','0'); meta(inst,'identify_id','1')
    ET.SubElement(assemble,'assemble_item',{'object_id':str(wrapper_id),'instance_id':'0','transform':transform,'offset':'0 0 0'})
    title=f"Zudo Bambu Blank {panel.get('hp','?')}HP — {art.get('name',art.get('patternId','pattern'))}"
    for key,val in [('Title',title),('Description','Generated by zudo-bambu-blanks from a Surface Lab regional recipe.'),('ModificationDate',date.today().isoformat())]:
        el=next((e for e in root.findall(q('metadata')) if e.get('name')==key),None)
        if el is None:
            el=ET.Element(q('metadata'),{'name':key}); root.insert(list(root).index(resources),el)
        el.text=val
    clear_cache(data); data[MODEL]=xml_bytes(root); data[OBJECTS]=xml_bytes(conf)
    write_zip(data,output)
    return {'status':'generated_unsliced_project','output':str(output),'panel':{'hp':panel.get('hp'),'width':w,'height':h,'thickness':t},'pattern':{'id':art.get('patternId'),'name':art.get('name'),'regions':len(regions)},'modifier_height_mm':mod_h,'template_printer':settings.get('printer_model'),'nozzle_diameter':settings.get('nozzle_diameter'),'notes':['Unsliced project; inspect first two layers in Bambu Studio before printing.','Finished-face orientation/mirroring must be confirmed in Studio for asymmetric artwork.']}

def inspect(path):
    data=read_zip(path); root=ET.fromstring(data[MODEL]); conf=ET.fromstring(data[OBJECTS]); settings=json.loads(data[SETTINGS])
    return {'members':len(data),'build_items':len(root.findall(f'{q("build")}/{q("item")}')),'parts':[{'id':p.get('id'),'subtype':p.get('subtype'),'name':next((m.get('value') for m in p.findall('metadata') if m.get('key')=='name'),None)} for p in conf.findall('object/part')],'printer_model':settings.get('printer_model'),'nozzle_diameter':settings.get('nozzle_diameter'),'contains_toolpaths':any(re.search(r'\.(?:gcode|bgcode)(?:\.|$)',n,re.I) for n in data)}

def main():
    ap=argparse.ArgumentParser(); sub=ap.add_subparsers(dest='cmd',required=True)
    g=sub.add_parser('generate'); g.add_argument('--template',required=True); g.add_argument('--recipe',required=True); g.add_argument('--output',required=True)
    i=sub.add_parser('inspect'); i.add_argument('input')
    a=ap.parse_args()
    try:
        if a.cmd=='generate': result=build(json.loads(Path(a.recipe).read_text()),a.template,a.output)
        else: result=inspect(a.input)
        print(json.dumps(result,indent=2))
    except Exception as e:
        print(json.dumps({'error':str(e)}),file=sys.stderr); return 2
    return 0
if __name__=='__main__': sys.exit(main())
