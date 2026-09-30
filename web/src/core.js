/* Zudo panel-surface study — procedural, clipped preview geometry.
 * MIT licensed. Independent sketches, not Bambu Studio toolpaths.
 * Units: millimetres. Coordinates: top left, x right, y down.
 * No dependencies, DOM, network, or machine-code generation.
 */
(function (root, factory) {
  const api = factory();
  root.ZudoPatterns = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PI = Math.PI, TAU = PI * 2, EPS = 1e-8;
  const MAX_POINTS = 100000;
  const metadata = [
    { id: 'triangular-facets', name: 'Triangular facets', kind: 'regional', description: 'Six broad cells divided into triangles; three directions reveal changing facets.' },
    { id: 'basket-weave', name: 'Basket weave', kind: 'regional', description: 'A rectangular patchwork alternates horizontal and vertical filament directions.' },
    { id: 'chevron', name: 'Chevron bands', kind: 'regional', description: 'Broad V-shaped bands meet on the center line, with alternating directional sheen.' },
    { id: 'sunburst', name: 'Sunburst facets', kind: 'regional', description: 'Eight directional sectors surround a calm octagonal center, avoiding tiny pointed regions.' },
    { id: 'wave-field', name: 'Wave field', kind: 'custom', description: 'Smooth parallel wave sketches fill the artwork rectangle.' },
    { id: 'organic-contours', name: 'Organic contours', kind: 'custom', description: 'Nested, gently irregular contours suggest topographic layers or tree rings.' },
    { id: 'truchet-flow', name: 'Truchet arc flow', kind: 'custom', description: 'Seeded arc tiles form an architectural flowing texture.' },
    { id: 'guilloche', name: 'Guilloché rosette', kind: 'artwork', description: 'Interlaced rosette curves for visual exploration; crossings require a separate print strategy.' },
    { id: 'octagram', name: 'Octagram spiral', kind: 'builtin-sketch', description: 'An eight-point spiral sketch inspired by the name of the existing slicer pattern.' },
    { id: 'archimedean', name: 'Archimedean spiral', kind: 'builtin-sketch', description: 'A uniformly expanding spiral clipped to the rectangle.' },
    { id: 'hilbert', name: 'Hilbert curve', kind: 'builtin-sketch', description: 'An orthogonal space-filling curve, scaled without stretching and cropped to the rectangle.' }
  ];

  function finite(name, value, fallback, min, max) {
    const n = value === undefined ? fallback : Number(value);
    if (!Number.isFinite(n)) throw new TypeError(name + ' must be finite');
    if (n < min || n > max) throw new RangeError(name + ' must be in [' + min + ', ' + max + ']');
    return n;
  }
  function params(input) {
    const o = input || {};
    return {
      width: finite('width', o.width, 20, 1, 500),
      height: finite('height', o.height, 104, 1, 500),
      pitch: finite('pitch', o.pitch, .62, .15, 8),
      scale: finite('scale', o.scale, 1, .25, 4),
      amplitude: finite('amplitude', o.amplitude, 3, 0, 30),
      rotation: finite('rotation', o.rotation, 0, -3600, 3600) % 360,
      seed: finite('seed', o.seed, 1, -2147483648, 2147483647) | 0
    };
  }
  function clamp(n, low, high) { return Math.max(low, Math.min(high, n)); }
  function equal(a, b) { return Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS; }
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a += 0x6D2B79F5;
      let t = a;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function rect(w, h) { return [[0, 0], [w, 0], [w, h], [0, h]]; }
  function area(poly) {
    let a = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
  }
  // Sutherland–Hodgman half-plane clipping. Retain a*x+b*y+c >= 0.
  function clipHalfPlane(poly, a, b, c) {
    if (!poly.length) return [];
    const out = [];
    let prev = poly[poly.length - 1], dp = a * prev[0] + b * prev[1] + c;
    for (const current of poly) {
      const dc = a * current[0] + b * current[1] + c;
      const prevIn = dp >= -EPS, currentIn = dc >= -EPS;
      if (prevIn !== currentIn) {
        const t = dp / (dp - dc);
        out.push([prev[0] + t * (current[0] - prev[0]), prev[1] + t * (current[1] - prev[1])]);
      }
      if (currentIn) out.push(current.slice());
      prev = current; dp = dc;
    }
    return dedupe(out, true);
  }
  function dedupe(points, closed) {
    const out = [];
    for (const p of points) if (!out.length || !equal(p, out[out.length - 1])) out.push(p);
    if (closed && out.length > 1 && equal(out[0], out[out.length - 1])) out.pop();
    return out;
  }
  function clipPolygon(poly, w, h) {
    let p = clipHalfPlane(poly, 1, 0, 0);
    p = clipHalfPlane(p, -1, 0, w);
    p = clipHalfPlane(p, 0, 1, 0);
    p = clipHalfPlane(p, 0, -1, h);
    return p.map(v => [clamp(v[0], 0, w), clamp(v[1], 0, h)]);
  }
  // Convex polygon segment clip, winding independent.
  function clipSegmentPolygon(start, end, polygon) {
    if (polygon.length < 3) return null;
    let low = 0, high = 1;
    const sign = area(polygon) >= 0 ? 1 : -1;
    const dx = end[0] - start[0], dy = end[1] - start[1];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      const ex = b[0] - a[0], ey = b[1] - a[1];
      const value = sign * (ex * (start[1] - a[1]) - ey * (start[0] - a[0]));
      const delta = sign * (ex * dy - ey * dx);
      if (Math.abs(delta) < EPS) { if (value < -EPS) return null; continue; }
      const hit = -value / delta;
      if (delta > 0) low = Math.max(low, hit);
      else high = Math.min(high, hit);
      if (low > high + EPS) return null;
    }
    if (high - low <= EPS) return null;
    return [[start[0] + low * dx, start[1] + low * dy], [start[0] + high * dx, start[1] + high * dy]];
  }
  function clipPolyline(points, polygon) {
    const result = [];
    let run = [];
    for (let i = 1; i < points.length; i++) {
      const clipped = clipSegmentPolygon(points[i - 1], points[i], polygon);
      if (!clipped) {
        if (run.length > 1) result.push(run);
        run = []; continue;
      }
      if (run.length && equal(run[run.length - 1], clipped[0])) run.push(clipped[1]);
      else {
        if (run.length > 1) result.push(run);
        run = clipped;
      }
    }
    if (run.length > 1) result.push(run);
    return result.map(p => dedupe(p, false)).filter(p => p.length > 1);
  }
  function rotatePoint(point, angle, cx, cy) {
    const t = angle * PI / 180, c = Math.cos(t), s = Math.sin(t);
    const x = point[0] - cx, y = point[1] - cy;
    return [cx + x * c - y * s, cy + x * s + y * c];
  }
  function addClipped(out, points, p, extra, polygon, rotate) {
    const moved = rotate === false || !p.rotation ? points : points.map(v => rotatePoint(v, p.rotation, p.width / 2, p.height / 2));
    for (const run of clipPolyline(moved, polygon || rect(p.width, p.height))) {
      out.push(Object.assign({ points: run, closed: false }, extra || {}));
    }
  }
  function bounds(poly) {
    return {
      minX: Math.min.apply(null, poly.map(v => v[0])), maxX: Math.max.apply(null, poly.map(v => v[0])),
      minY: Math.min.apply(null, poly.map(v => v[1])), maxY: Math.max.apply(null, poly.map(v => v[1]))
    };
  }
  function hatch(polygon, angle, pitch) {
    const t = angle * PI / 180, d = [Math.cos(t), Math.sin(t)], n = [-d[1], d[0]];
    const projections = polygon.map(v => v[0] * n[0] + v[1] * n[1]);
    const lo = Math.min.apply(null, projections), hi = Math.max.apply(null, projections);
    const box = bounds(polygon), extent = Math.hypot(box.maxX, box.maxY) * 2 + 1000;
    const lines = [], spacing = Math.max(pitch, (hi - lo) / 700);
    // A fixed global phase makes adjacent equal-angle regions align.
    for (let k = Math.ceil((lo + EPS) / spacing); k * spacing < hi - EPS; k++) {
      const s = k * spacing;
      const a = [n[0] * s - d[0] * extent, n[1] * s - d[1] * extent];
      const b = [n[0] * s + d[0] * extent, n[1] * s + d[1] * extent];
      const clipped = clipSegmentPolygon(a, b, polygon);
      if (clipped) lines.push({ points: clipped, closed: false, angle });
    }
    return lines;
  }
  function regional(p, regions, note) {
    const out = [], clean = [];
    for (const region of regions) {
      const polygon = clipPolygon(region.polygon, p.width, p.height);
      if (polygon.length < 3 || Math.abs(area(polygon)) < EPS) continue;
      const angle = (region.angle + p.rotation) % 180;
      const id = clean.length;
      clean.push({ polygon, angle, id });
      for (const path of hatch(polygon, angle, p.pitch)) out.push(Object.assign(path, { region: id }));
    }
    return { paths: out, regions: clean, notes: [note, 'Modifier-region concept. Lines depict direction and nominal pitch; actual walls, seams, joins, spacing and toolpath order are determined by the slicer. Rotation changes hatch direction, while region borders stay fixed.'] };
  }

  function facets(p) {
    const rows = clamp(Math.round(6 / p.scale), 2, 16), h = p.height / rows, regions = [];
    for (let i = 0; i < rows; i++) {
      const y = i * h, z = (i + 1) * h, w = p.width;
      const polys = i % 2 ? [[[0,y],[w,y],[0,z]], [[w,y],[w,z],[0,z]]] : [[[0,y],[w,y],[w,z]], [[0,y],[w,z],[0,z]]];
      polys.forEach((polygon, j) => regions.push({ polygon, angle: [0,60,120][(i + j) % 3] }));
    }
    return regional(p, regions, 'The default is six rows and twelve triangular regions, matching the first panel experiment.');
  }
  function basket(p) {
    const target = Math.max(8, Math.min(p.width, p.height) / 4) * p.scale;
    const cols = clamp(Math.round(p.width / target), 1, 12), rows = clamp(Math.round(p.height / target), 1, 24);
    const cw = p.width / cols, ch = p.height / rows, regions = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      regions.push({ polygon: [[x*cw,y*ch],[(x+1)*cw,y*ch],[(x+1)*cw,(y+1)*ch],[x*cw,(y+1)*ch]], angle: (x+y)%2 ? 90 : 0 });
    }
    return regional(p, regions, 'Alternating broad rectangular regions; very narrow cells may lose detail after perimeter and spacing constraints.');
  }
  function chevron(p) {
    const regions = [], center = p.width / 2, band = Math.max(8, Math.min(p.width, p.height) * .3) * p.scale;
    for (let side = 0; side < 2; side++) {
      const x0 = side ? center : 0, x1 = side ? p.width : center;
      const slope = side ? -.6 : .6;
      const base = [[x0,0],[x1,0],[x1,p.height],[x0,p.height]];
      const vals = base.map(v => v[1] - slope * (v[0] - center));
      for (let k = Math.floor(Math.min.apply(null, vals) / band); k <= Math.ceil(Math.max.apply(null, vals) / band); k++) {
        let polygon = clipHalfPlane(base, -slope, 1, slope * center - k * band);
        polygon = clipHalfPlane(polygon, slope, -1, (k+1)*band - slope * center);
        regions.push({ polygon, angle: (side ? 149 : 31) + ((k%2+2)%2 ? 90 : 0) });
      }
    }
    return regional(p, regions, 'Paired diagonal slabs form V bands. Broad bands avoid the many tiny interruptions of fine herringbone.');
  }
  function sunburst(p) {
    const regions = [], hub = [], cx = p.width/2, cy = p.height/2;
    const inner = Math.min(p.width,p.height)*.14*p.scale, outer = Math.hypot(p.width,p.height)*3;
    for (let i = 0; i < 8; i++) {
      const a = i*TAU/8-PI/8, b = (i+1)*TAU/8-PI/8;
      const at = r => [cx+r*Math.cos(a),cy+r*Math.sin(a)], bt = r => [cx+r*Math.cos(b),cy+r*Math.sin(b)];
      hub.push(at(inner));
      regions.push({polygon:[at(inner),at(outer),bt(outer),bt(inner)],angle:(a+b)*90/PI});
    }
    regions.unshift({polygon:hub,angle:0});
    return regional(p, regions, 'A central octagon separates the pointed sector tips; its nominal radius scales with the design size.');
  }
  function waves(p) {
    const paths=[], cx=p.width/2, cy=p.height/2;
    const b=bounds(rect(p.width,p.height).map(v=>rotatePoint(v,-p.rotation,cx,cy)));
    const amplitude=Math.min(p.amplitude,Math.min(p.width,p.height)*.3), wavelength=24*p.scale;
    const pitch=Math.max(p.pitch,(b.maxY-b.minY+2*amplitude)/500);
    const count=Math.ceil((b.maxY-b.minY+2*amplitude)/pitch)+2;
    const steps=clamp(Math.floor(40000/count),16,Math.max(16,Math.ceil((b.maxX-b.minX)/(wavelength/64))));
    const random=rng(p.seed), phase=random()*TAU;
    for(let y=b.minY-amplitude-pitch;y<=b.maxY+amplitude+pitch;y+=pitch){
      const points=[];
      for(let j=0;j<=steps;j++){
        const x=b.minX+(b.maxX-b.minX)*j/steps;
        points.push([x,y+amplitude*Math.sin(x*TAU/wavelength+phase)]);
      }
      addClipped(paths,points,p);
    }
    return {paths,regions:[],notes:['Custom mathematical sketch. Vertical offsets between waves do not produce constant perpendicular bead spacing. A printable implementation needs coverage and extrusion planning.']};
  }
  function contours(p) {
    const paths=[], random=rng(p.seed), phase1=random()*TAU,phase2=random()*TAU;
    const warp=Math.min(.27,p.amplitude/20), maxR=Math.hypot(p.width,p.height)/2/(1-warp*1.5)*1.1;
    const pitch=Math.max(p.pitch,maxR/300), rings=Math.ceil(maxR/pitch);
    const steps=clamp(Math.floor(45000/rings),48,480);
    for(let i=1;i<=rings;i++){
      const r=i*pitch, points=[];
      for(let j=0;j<=steps;j++){
        const t=j*TAU/steps;
        const v=r*(1+warp*Math.sin(3*t+phase1)+warp*.45*Math.sin((4+Math.round(p.scale))*t+phase2));
        points.push([p.width/2+v*Math.cos(t),p.height/2+v*Math.sin(t)]);
      }
      addClipped(paths,points,p);
    }
    return {paths,regions:[],notes:['Nested star-shaped contour sketches do not cross one another, but their perpendicular spacing varies. Flow compensation, center treatment and coverage must be designed before printing.']};
  }
  function truchet(p) {
    const paths=[], random=rng(p.seed), target=Math.max(12,Math.min(p.width,p.height)/3)*p.scale;
    const cols=clamp(Math.round(p.width/target),1,10), rows=clamp(Math.round(p.height/target),1,18);
    const cw=p.width/cols,ch=p.height/rows;
    for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
      const x0=x*cw,y0=y*ch,x1=x0+cw,y1=y0+ch,flip=random()>.5;
      const cells=flip ? [
        {poly:[[x0,y0],[x1,y0],[x1,y1]],center:[x1,y0]},
        {poly:[[x0,y0],[x1,y1],[x0,y1]],center:[x0,y1]}
      ] : [
        {poly:[[x0,y0],[x1,y0],[x0,y1]],center:[x0,y0]},
        {poly:[[x1,y0],[x1,y1],[x0,y1]],center:[x1,y1]}
      ];
      for(const cell of cells){
        const maxR=Math.hypot(cw,ch), spacing=Math.max(p.pitch,maxR/100);
        for(let r=spacing/2;r<maxR;r+=spacing){
          const points=[], steps=clamp(Math.ceil(TAU*r/1.2),32,96);
          for(let j=0;j<=steps;j++){
            const t=j*TAU/steps;points.push([cell.center[0]+r*Math.cos(t),cell.center[1]+r*Math.sin(t)]);
          }
          const first=clipPolyline(points,cell.poly);
          for(const run of first)addClipped(paths,run,p);
        }
      }
    }
    return {paths,regions:[],notes:['Quarter-arc families are clipped to nearest-corner triangular cells. The paths show an arc-tile concept; joins between tiles and density need engineering before toolpath use. Rotation rotates and crops the complete tile layout.']};
  }
  function guilloche(p) {
    const paths=[], random=rng(p.seed), phase=random()*TAU, lobes=clamp(Math.round(7*p.scale),3,18);
    const loops=clamp(Math.round(Math.min(p.width,p.height)/p.pitch*.8),18,64), steps=512;
    const wobble=.05+p.amplitude/60;
    for(let k=0;k<loops;k++){
      const r=.1+1.8*k/(loops-1), points=[];
      for(let j=0;j<=steps;j++){
        const t=j*TAU/steps, petal=wobble*Math.cos(lobes*t+phase+k*.8);
        points.push([p.width/2+p.width*.46*(r+petal)*Math.cos(t),p.height/2+p.height*.46*(r+petal)*Math.sin(t)]);
      }
      addClipped(paths,points,p);
    }
    return {paths,regions:[],notes:['Artwork only: this rosette deliberately allows curve crossings and changing density. These curves cannot be treated as a finished solid first-layer toolpath.']};
  }
  function archimedean(p) {
    const paths=[], random=rng(p.seed), phase=random()*TAU, radius=Math.hypot(p.width,p.height)/2*1.02;
    const pitch=p.pitch*p.scale, turns=radius/pitch, steps=clamp(Math.ceil(TAU*radius*turns/.9),800,45000), points=[];
    for(let i=0;i<=steps;i++){
      const t=i/steps*TAU*turns, r=radius*i/steps;
      points.push([p.width/2+r*Math.cos(t+phase),p.height/2+r*Math.sin(t+phase)]);
    }
    addClipped(paths,points,p);
    return {paths,regions:[],notes:['Built-in pattern concept sketch, not Bambu Studio output. Studio may choose different centering, clipping, joins and spacing.']};
  }
  function octagram(p) {
    const paths=[], radius=Math.hypot(p.width,p.height)*.85, pitch=Math.max(p.pitch*p.scale,radius/1500);
    const turns=clamp(Math.ceil(radius/pitch),1,1500), points=[];
    for(let i=0;i<=turns*16;i++){
      const t=i*TAU/16, r=(i/16)*pitch*(i%2 ? .64:1);
      points.push([p.width/2+r*Math.cos(t),p.height/2+r*Math.sin(t)]);
    }
    addClipped(paths,points,p);
    return {paths,regions:[],notes:['An independent eight-point radial spiral illustration, not a reproduction of Bambu Studio’s Octagram Spiral algorithm. Its appearance in the slicer will differ.']};
  }
  function hilbertPoint(order,index){
    let x=0,y=0,t=index;
    for(let scale=1;scale<(1<<order);scale*=2){
      const rx=(t>>1)&1,ry=(t^rx)&1;
      if(ry===0){if(rx===1){x=scale-1-x;y=scale-1-y;}const temp=x;x=y;y=temp;}
      x+=scale*rx;y+=scale*ry;t>>=2;
    }
    return [x,y];
  }
  function hilbert(p){
    const paths=[], size=Math.max(p.width,p.height), spacing=p.pitch*p.scale;
    const order=clamp(Math.round(Math.log2(size/spacing)),3,7), n=1<<order, step=size/n;
    const points=[],ox=(p.width-size)/2,oy=(p.height-size)/2;
    for(let i=0;i<n*n;i++){
      const q=hilbertPoint(order,i);points.push([ox+(q[0]+.5)*step,oy+(q[1]+.5)*step]);
    }
    addClipped(paths,points,p);
    return {paths,regions:[],notes:['A conventional Hilbert-curve sketch on a square lattice cropped to the rectangle. This is not Bambu Studio’s actual fill path; lattice spacing snaps to the selected curve order.']};
  }

  const generators={
    'triangular-facets':facets,'basket-weave':basket,'chevron':chevron,'sunburst':sunburst,
    'wave-field':waves,'organic-contours':contours,'truchet-flow':truchet,'guilloche':guilloche,
    'octagram':octagram,'archimedean':archimedean,'hilbert':hilbert
  };
  function generate(id,input){
    const meta=metadata.find(item=>item.id===id);
    if(!meta)throw new RangeError('Unknown pattern: '+id);
    const p=params(input),data=generators[id](p);
    let pointCount=0;
    // Enforce a predictable preview budget. Regional hatching is cheap but may
    // also exceed the budget for extreme 500 mm / 0.15 mm input combinations.
    const originalCount=data.paths.reduce((n,path)=>n+path.points.length,0);
    if(originalCount>MAX_POINTS){
      const originalPaths=data.paths;
      let stride=Math.ceil(originalCount/MAX_POINTS);
      do {
        data.paths=originalPaths.filter((_,i)=>i%stride===0);
        stride++;
      } while(data.paths.reduce((n,path)=>n+path.points.length,0)>MAX_POINTS && stride<=originalPaths.length);
      data.notes.push('Preview density was reduced to stay within the 100,000-point display budget.');
    }
    for(const path of data.paths){
      path.points=path.points.map(v=>{
        if(!Number.isFinite(v[0])||!Number.isFinite(v[1]))throw new Error('Invalid generated point');
        return [clamp(v[0],0,p.width),clamp(v[1],0,p.height)];
      });
      pointCount+=path.points.length;
    }
    return Object.assign(data,{id,name:meta.name,kind:meta.kind,parameters:p,pointCount});
  }
  return {version:'1.0.0',metadata,generate,MAX_POINTS,geometry:{clipPolygon,clipPolyline,clipSegmentPolygon,area}};
});

/* Shared millimetre geometry and appearance renderer. No printer commands. */
(function(root) {
  'use strict';
  const n = value => Number(value.toFixed(4));
  const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
  function color(hex, factor) {
    const rgb = hex.replace('#','').match(/../g).map(x=>parseInt(x,16));
    return '#' + rgb.map(v=>Math.round(clamp(v*factor,0,255)).toString(16).padStart(2,'0')).join('');
  }
  const routeNames = {regional:'Regional fill study',custom:'Custom curve concept',artwork:'Artwork concept','builtin-sketch':'Slicer-pattern sketch',image:'Image reference'};
  const routeNotes = {
    regional:'These polygons can guide separate first-layer modifiers with different fill directions. The recipe records region geometry and angles; a slicer adapter and a sliced preview are still needed.',
    custom:'These are custom curve sketches. Turning them into a solid first layer requires controlled bead spacing, non-overlapping coverage, path ordering, extrusion calculation, and a verified slicer or toolpath adapter.',
    artwork:'These interlaced curves are visual artwork. Crossings and uneven coverage need a separate manufacturing design before printing.',
    'builtin-sketch':'This is an independent geometric sketch, not Bambu Studio output. The matching Studio pattern must be sliced to check its actual scale, origin, spacing, and boundary behavior.',
    image:'This image is fitted into the rectangular artwork area. Pixel colors do not specify filament directions or extrusion paths; manufacturing needs a separate geometry or material mapping.'
  };
  function create(panel, state) {
    const border = Math.min(state.sideInset,(panel.width-1)/2);
    const rectangle = {x:border,y:state.endZone,width:panel.width-2*border,height:panel.height-2*state.endZone};
    const pattern = state.image ? {id:'image',name:state.image.name,kind:'image',paths:[],regions:[],notes:[]} : root.ZudoPatterns.compose(state.patternId,{width:rectangle.width,height:rectangle.height,pitch:state.pitch,scale:state.scale,amplitude:state.amplitude,detail:state.detail,jitter:state.jitter,rotation:state.rotation,hatchAngle:state.hatchAngle,seed:state.seed,stretchX:state.stretchX,stretchY:state.stretchY,offsetX:state.offsetX,offsetY:state.offsetY,symmetry:state.symmetry},state.secondaryPattern,state.compositionMode,state.splitRatio,state.secondaryRotation);
    const plain = [];
    const step = state.pitch*Math.SQRT2;
    for(let b=-panel.width;b<=panel.height;b+=step) {
      const x1=Math.max(0,-b),y1=Math.max(0,b),x2=Math.min(panel.width,panel.height-b),y2=Math.min(panel.height,panel.width+b);
      if(x2>x1) plain.push({points:[[x1,y1],[x2,y2]]});
    }
    return {panel,state,rectangle,pattern,plain};
  }
  function bins(paths, state) {
    const buckets=Array.from({length:48},()=>[]);
    for(const path of paths) {
      const pts=path.points;
      for(let i=1;i<pts.length;i++) {
        const a=pts[i-1],b=pts[i];
        const angle=((Math.atan2(b[1]-a[1],b[0]-a[0])*180/Math.PI)%180+180)%180;
        const bin=Math.min(23,Math.floor(angle/7.5))+(path.layer===1?24:0);
        buckets[bin].push([a,b]);
      }
      if(path.closed&&pts.length>2) {
        const a=pts[pts.length-1],b=pts[0];
        const angle=((Math.atan2(b[1]-a[1],b[0]-a[0])*180/Math.PI)%180+180)%180;
        buckets[Math.min(23,Math.floor(angle/7.5))+(path.layer===1?24:0)].push([a,b]);
      }
    }
    return buckets.map((segments,i)=>{
      const phase=((i%24)*7.5+3.75-state.lightAngle)*Math.PI/180;
      const factor=.89+(state.sheen/100)*(.63*Math.cos(2*phase)+.22);
      return {segments,color:state.renderStyle==='lines'?'#eee3cb':color(state.color,factor),opacity:i>=24&&state.compositionMode==='overlay'?(state.overlayOpacity??.45):1};
    }).filter(b=>b.segments.length);
  }
  function placement(study) {
    const {state,rectangle:r}=study,img=state.image;
    const ratio=(state.imageFit==='contain'?Math.min:Math.max)(r.width/img.width,r.height/img.height)*state.imageZoom;
    const width=img.width*ratio,height=img.height*ratio;
    return {x:r.x+(r.width-width)/2+r.width*state.imageOffsetX/100,y:r.y+(r.height-height)/2+r.height*state.imageOffsetY/100,width,height};
  }
  function svgStrokes(paths,state) {
    return bins(paths,state).map(b=>'<path stroke="'+b.color+'" opacity="'+b.opacity+'" d="'+b.segments.map(([a,c])=>'M'+n(a[0])+','+n(a[1])+'L'+n(c[0])+','+n(c[1])).join('')+'"/>').join('');
  }
  function svg(study, options={}) {
    const {panel:p,state:s,rectangle:r,pattern}=study;
    const boundary=options.boundary===undefined?s.showZones:options.boundary;
    const outer=p.outer.map(q=>q.map(n).join(',')).join(' ');
    const holes=p.holes.map(h=>'<rect x="'+n(h.x-h.width/2)+'" y="'+n(h.y-h.height/2)+'" width="'+n(h.width)+'" height="'+n(h.height)+'" rx="'+n(h.radius)+'" fill="black"/>').join('');
    const hatch='<g fill="none" stroke-width="'+n(s.pitch*(s.strokeRatio??.76))+'" stroke-linecap="butt" stroke-linejoin="round">'+svgStrokes(study.plain,s)+'</g>';
    let art='';
    if(s.image) {
      const box=placement(study);
      art='<image x="'+n(box.x)+'" y="'+n(box.y)+'" width="'+n(box.width)+'" height="'+n(box.height)+'" preserveAspectRatio="none" href="'+esc(s.image.dataUrl)+'"/>';
    } else {
      art='<g transform="translate('+n(r.x)+' '+n(r.y)+')" fill="none" stroke-width="'+n(s.pitch*(s.strokeRatio??.76))+'" stroke-linecap="butt" stroke-linejoin="round">'+svgStrokes(pattern.paths,s)+'</g>';
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" width="'+n(p.width)+'mm" height="'+n(p.height)+'mm" viewBox="0 0 '+n(p.width)+' '+n(p.height)+'" role="img" aria-label="'+esc(p.label+' '+pattern.name+' panel appearance preview')+'">'+
      '<title>'+esc(p.label+' · '+pattern.name)+'</title><metadata>'+esc(JSON.stringify({app:'Zudo Surface Lab',status:'appearance-preview-not-sliced',source:p.sourceUrl,artwork:r}))+'</metadata>'+
      '<defs><mask id="panel-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="'+n(p.width)+'" height="'+n(p.height)+'"><polygon points="'+outer+'" fill="white"/>'+holes+'</mask><clipPath id="art-clip"><rect x="'+n(r.x)+'" y="'+n(r.y)+'" width="'+n(r.width)+'" height="'+n(r.height)+'"/></clipPath></defs>'+
      '<g mask="url(#panel-mask)"><rect width="100%" height="100%" fill="'+(s.renderStyle==='lines'?'#20262b':color(s.color,.66))+'"/>'+hatch+'<g clip-path="url(#art-clip)"><rect x="'+n(r.x)+'" y="'+n(r.y)+'" width="'+n(r.width)+'" height="'+n(r.height)+'" fill="'+(s.renderStyle==='lines'&&!s.image?'#20262b':color(s.color,s.image ? .95 : .66))+'"/>'+art+'</g>'+
      (boundary?'<rect x="'+n(r.x+.12)+'" y="'+n(r.y)+'" width="'+n(Math.max(.5,r.width-.24))+'" height="'+n(r.height)+'" fill="none" stroke="#eff7fb" stroke-opacity=".85" stroke-width=".2" stroke-dasharray="1.2 .9"/>':'')+'</g><polygon points="'+outer+'" fill="none" stroke="'+color(s.color,.45)+'" stroke-width=".16"/>'+p.holes.map(h=>'<rect x="'+n(h.x-h.width/2)+'" y="'+n(h.y-h.height/2)+'" width="'+n(h.width)+'" height="'+n(h.height)+'" rx="'+n(h.radius)+'" fill="none" stroke="'+color(s.color,.45)+'" stroke-width=".16"/>').join('')+'</svg>';
  }
  function paint(ctx,study,pixelWidth,pixelHeight) {
    const {panel:p,state:s,rectangle:r}=study;
    ctx.save();ctx.setTransform(pixelWidth/p.width,0,0,pixelHeight/p.height,0,0);
    ctx.fillStyle=(s.renderStyle==='lines'?'#20262b':color(s.color,.66));ctx.fillRect(0,0,p.width,p.height);
    function strokes(paths){
      ctx.lineWidth=s.pitch*(s.strokeRatio??.76);ctx.lineCap='butt';ctx.lineJoin='round';
      for(const b of bins(paths,s)){ctx.strokeStyle=b.color;ctx.globalAlpha=b.opacity;ctx.beginPath();for(const [a,c]of b.segments){ctx.moveTo(a[0],a[1]);ctx.lineTo(c[0],c[1]);}ctx.stroke();}ctx.globalAlpha=1;
    }
    strokes(study.plain);
    ctx.save();ctx.beginPath();ctx.rect(r.x,r.y,r.width,r.height);ctx.clip();
    ctx.fillStyle=(s.renderStyle==='lines'&&!s.image?'#20262b':color(s.color,s.image ? .95 : .66));ctx.fillRect(r.x,r.y,r.width,r.height);
    if(s.image&&s.image.element){const b=placement(study);ctx.drawImage(s.image.element,b.x,b.y,b.width,b.height);}
    else{ctx.translate(r.x,r.y);strokes(study.pattern.paths);}
    ctx.restore();ctx.restore();
  }
  function recipe(study) {
    const {panel:p,state:s,rectangle:r,pattern}=study;
    return {
      schema:'zudo-surface-preview/v2',engineVersion:root.ZudoPatterns.version,units:'mm',coordinateSystem:'Finished-face top-left; X right, Y down. Printer transforms and face-down mirroring have not been applied.',
      panel:{id:p.id,hp:p.hp,width:p.width,height:p.height,studyThickness:s.thickness,outer:p.outer,holes:p.holes,sourceThickness:p.sourceThickness,sourceUrl:p.sourceUrl,sourceGeometry:p.sourceGeometry},
      artwork:{rectangle:r,patternId:pattern.id,name:pattern.name,kind:pattern.kind,parameters:pattern.parameters||{},composition:pattern.layers||null,regions:pattern.regions.map(q=>({...q,polygon:q.polygon.map(v=>[n(v[0]+r.x),n(v[1]+r.y)])}))},
      reference:s.image?{name:s.image.name,dataUrl:s.image.dataUrl,width:s.image.width,height:s.image.height,sourceUrl:s.image.sourceUrl||null,credit:s.image.credit||null,fit:s.imageFit,zoom:s.imageZoom,offsetXPercent:s.imageOffsetX,offsetYPercent:s.imageOffsetY}:null,
      appearance:{color:s.color,lightAngle:s.lightAngle,sheen:s.sheen,showArtworkBoundary:s.showZones,renderStyle:s.renderStyle,strokeRatio:s.strokeRatio,overlayOpacity:s.overlayOpacity},
      editorState:Object.fromEntries(Object.entries(s).filter(([k,v])=>k!=='image'&&typeof v!=='function')),
      pathData:{coordinates:'Artwork-local millimetres; top-left, X right, Y down',paths:pattern.paths.map(q=>({points:q.points.map(v=>v.map(n)),closed:!!q.closed,layer:q.layer||0}))},
      manufacturing:{status:'unsliced-study',plainZones:{pattern:'monotonic',angle:45},intent:'Decoration on the build-plate face only; modifier Z range depends on first-layer settings.',route:routeNotes[pattern.kind],notes:['Line pitch is a display parameter, not a calibrated extrusion width.','Perimeters can reduce the actual decorated fill span.','The preview is not a 3MF file, G-code, or a Bambu Studio slice.',...pattern.notes]}
    };
  }
  function geometry(THREE,p,depth) {
    const shape=new THREE.Shape();
    p.outer.forEach((q,i)=>shape[i?'lineTo':'moveTo'](q[0]-p.width/2,p.height/2-q[1]));shape.closePath();
    for(const h of p.holes){
      const x=h.x-p.width/2,y=p.height/2-h.y,w=h.width,hh=h.height,r=h.radius;
      const hole=new THREE.Path();
      hole.moveTo(x-w/2+r,y-hh/2);hole.lineTo(x+w/2-r,y-hh/2);
      hole.absarc(x+w/2-r,y-hh/2+r,r,-Math.PI/2,0,false);
      hole.lineTo(x+w/2,y+hh/2-r);hole.absarc(x+w/2-r,y+hh/2-r,r,0,Math.PI/2,false);
      hole.lineTo(x-w/2+r,y+hh/2);hole.absarc(x-w/2+r,y+hh/2-r,r,Math.PI/2,Math.PI,false);
      hole.lineTo(x-w/2,y-hh/2+r);hole.absarc(x-w/2+r,y-hh/2+r,r,Math.PI,Math.PI*1.5,false);
      hole.closePath();shape.holes.push(hole);
    }
    const g=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:false,curveSegments:24});
    const pos=g.attributes.position,uv=g.attributes.uv,norm=g.attributes.normal;
    for(let i=0;i<pos.count;i++)if(Math.abs(norm.getZ(i))>.5)uv.setXY(i,(pos.getX(i)+p.width/2)/p.width,(pos.getY(i)+p.height/2)/p.height);
    // The patterned cap is the finished face at +Z. The opposite face and
    // mounting walls use plain material, even when the user orbits behind it.
    g.clearGroups();let groupStart=0,materialIndex=norm.getZ(0)>.5?0:1;
    for(let i=3;i<pos.count;i+=3){const next=norm.getZ(i)>.5?0:1;if(next!==materialIndex){g.addGroup(groupStart,i-groupStart,materialIndex);groupStart=i;materialIndex=next;}}
    g.addGroup(groupStart,pos.count-groupStart,materialIndex);
    uv.needsUpdate=true;return g;
  }
  root.ZudoSurfaceCore={create,svg,paint,recipe,geometry,color,bins,placement,routeNames,routeNotes};
  if(typeof module==='object'&&module.exports)module.exports=root.ZudoSurfaceCore;
})(typeof globalThis==='undefined'?this:globalThis);