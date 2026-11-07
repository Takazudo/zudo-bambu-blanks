/* Zudo Surface Lab — extensible pattern registry, MIT.
 * Geometry is a design study, never extrusion/G-code. All outputs are clipped
 * to an exact millimetre rectangle. Regional designs form a complete partition.
 */
(function(root){
'use strict';
const legacy=root.ZudoPatterns, G=legacy.geometry, PI=Math.PI, TAU=2*PI, EPS=1e-7;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const rect=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
function rng(seed){let a=seed>>>0;return()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
function hash(x,y,s=0){let n=Math.imul(x|0,374761393)^Math.imul(y|0,668265263)^Math.imul(s|0,1442695041);n=Math.imul(n^(n>>>13),1274126177);return((n^(n>>>16))>>>0)/4294967296;}
const mix=(a,b,t)=>a+(b-a)*t;
function noise(x,y,seed){const i=Math.floor(x),j=Math.floor(y),u=x-i,v=y-j,fx=u*u*(3-2*u),fy=v*v*(3-2*v);return mix(mix(hash(i,j,seed),hash(i+1,j,seed),fx),mix(hash(i,j+1,seed),hash(i+1,j+1,seed),fx),fy);}
const registry=[];
function add(id,name,family,kind,description,algorithm,opts={}){registry.push({id,name,family,kind,description,algorithm,controls:opts.controls||[],defaults:{amplitude:.45,detail:6,jitter:.3,...opts.defaults},featured:!!opts.featured,random:!!opts.random});}
// A registry entry is a reproducible algorithm, not a saved seed or color variant.
const R=(id,n,d,f,o)=>add(id,n,'Directional regions','regional',d,f,o);
R('triangular-facets','Triangular facets','Broad triangular panels alternate three hatch directions.','facets',{featured:true});
R('basket-weave','Basket weave','Alternating rectangular patches of perpendicular grain.','basket',{featured:true});
R('chevron','Chevron bands','Mirrored diagonal slabs with alternating grain.','chevron',{controls:['amplitude']});
R('sunburst','Sunburst facets','Directional wedges surrounding a polygonal center.','sunburst',{controls:['detail','amplitude']});
R('facet-quilt','Facet quilt','A square quilt split into alternating diagonal facets.','quilt',{featured:true,random:true,controls:['jitter']});
R('diamond-facets','Diamond facets','A tessellation of diamonds with alternating grain.','diamonds');
R('pinwheel','Pinwheel facets','Four triangular faces turn around every tile center.','pinwheel',{featured:true});
R('prism-cubes','Prism cubes','Three rhombus faces tessellate into an isometric illusion.','cubes',{featured:true});
R('parquet','Parquet blocks','Alternating square blocks, each divided into floorboard strips.','parquet',{controls:['detail']});
R('tatami','Tatami mats','Offset long rectangles arranged in a calm alternating rhythm.','tatami');
R('running-brick','Running brick','Staggered rectangular regions with three grain directions.','brick');
R('windmill','Windmill blocks','Four rectangular arms surround a small square in every tile.','windmill');
R('diagonal-bands','Diagonal bands','Broad alternating diagonal regions across the whole panel.','bands');
R('quarter-sawn','Quarter-sawn strips','Seeded strips of varying width, with subtle grain shifts.','strips',{random:true,controls:['jitter']});
R('voronoi-facets','Voronoi facets','Seeded convex cells: an irregular but complete surface partition.','voronoi',{featured:true,random:true,controls:['jitter']});
R('fractured-glass','Fractured glass','A shared jittered lattice triangulates into irregular facets.','fracture',{random:true,controls:['jitter']});
R('triangle-tessellation','Triangle tessellation','An equilateral triangular lattice with three fill directions.','triangles');
R('hex-facets','Hexagonal facets','A honeycomb partition with three alternating grain directions.','hex');
R('nested-frames','Nested frames','Concentric rectangular bands split into four mitered faces.','frames');
R('offset-quilt','Offset quilt','Each square is divided around an off-center point.','offcenter',{random:true,controls:['jitter']});
const T=(id,n,d,f,o)=>add(id,n,'Lattices & tiles','artwork',d,f,o);
T('hemp-leaf','Hemp-leaf lattice','Six pointed leaves repeat across a triangular lattice.','hemp',{featured:true});
T('linked-circles','Linked circles','Overlapping circular cells create a repeating petal field.','linked');
T('wave-scales','Wave scales','Rows of nested semicircles create a layered wave motif.','scales',{featured:true,controls:['detail']});
T('hex-rings','Hex rings','Concentric hexagons inside a honeycomb lattice.','hexrings',{controls:['detail']});
T('key-fret','Key fret','Square spirals repeat in a tightly spaced key-like maze.','fret',{controls:['detail']});
T('nested-diamonds','Nested diamonds','Repeated diamond cells filled with smaller diamond outlines.','diamondrings',{controls:['detail']});
T('nested-triangles','Nested triangles','Rows of inset triangular contours.','trianglerings',{controls:['detail']});
T('arcade','Arcade arches','Alternating half-circle arches and their vertical stems.','arcade',{controls:['detail']});
T('staggered-fans','Staggered fans','Half-circle fans radiate through offset rows.','fans',{controls:['detail']});
T('cross-stitch','Cross stitch','Small crossed stitches on a staggered textile grid.','stitch');
T('diamond-mesh','Diamond mesh','Two diagonal line families produce an open diamond lattice.','mesh');
T('star-tiles','Star tiles','Eight-point stars alternate with small diamond centers.','startiles',{controls:['amplitude']});
const U=(id,n,d,f,o)=>add(id,n,'Truchet & mazes','custom',d,f,o);
U('truchet-flow','Truchet arc flow','Seeded quarter-circle tiles create connected looping paths.','truchet',{featured:true,random:true});
U('truchet-diagonal','Diagonal Truchet','Seeded diagonals meet in an angular tile maze.','diagtruchet',{random:true,controls:['detail']});
U('truchet-ribbons','Truchet ribbons','Multiple parallel arcs weave through each seeded tile.','ribbontruchet',{random:true,controls:['detail']});
U('truchet-triangles','Truchet triangles','Alternating nested triangular corners create zigzag channels.','triangletruchet',{random:true,controls:['detail']});
U('square-labyrinth','Square labyrinth','Seeded right-angle channels turn inside square cells.','labyrinth',{random:true,controls:['detail']});
U('circuit-tiles','Circuit tiles','Seeded orthogonal routes and circular terminal pads.','circuittiles',{random:true,controls:['detail']});
const W=(id,n,d,f,o)=>add(id,n,'Waves & flow','custom',d,f,o);
W('wave-field','Wave field','Parallel-offset sinusoidal curves; spacing is illustrative.','waves',{featured:true,controls:['amplitude']});
W('harmonic-waves','Harmonic waves','Two harmonics combine into a more intricate wave field.','harmonic',{controls:['amplitude','detail']});
W('braided-waves','Braided waves','Two phase-shifted wave families cross into a braided texture.','braid',{controls:['amplitude']});
W('chevron-lines','Chevron lines','Continuous angular waves repeat across the rectangle.','chevronlines',{controls:['amplitude']});
W('accordion','Accordion','A folded wave changes wavelength across the panel.','accordion',{controls:['amplitude']});
W('pulse-train','Pulse train','Rounded pulse-like curves suggest a synthesizer waveform.','pulse',{controls:['amplitude']});
W('sand-dunes','Sand dunes','Smooth spatial noise bends parallel lines into dune-like grain.','dunes',{featured:true,random:true,controls:['amplitude','jitter']});
W('stream-field','Stream field','Seeded lines follow a continuously varying direction field.','stream',{random:true,controls:['amplitude','detail']});
W('woven-waves','Woven waves','Crossed wave fields create a warped woven grid.','wovenwaves',{controls:['amplitude']});
W('ripple-interference','Ripple interference','Two circular wave sources overlap across the panel.','interference',{controls:['amplitude']});
const C=(id,n,d,f,o)=>add(id,n,'Contours & grain','custom',d,f,o);
C('organic-contours','Organic contours','Nested irregular rings around a common center.','organic',{featured:true,random:true,controls:['amplitude','detail']});
C('topographic','Topographic map','Marching-square contours of a seeded smooth height field.','topo',{featured:true,random:true,controls:['detail','jitter']});
C('woodgrain','Woodgrain','Elongated irregular rings suggest a figured wood surface.','wood',{random:true,controls:['amplitude','detail']});
C('agate','Agate bands','Nested contours with several fine undulations.','agate',{random:true,controls:['amplitude','detail']});
C('fingerprint','Fingerprint','Eccentric loops form an elongated fingerprint-like field.','fingerprint',{controls:['amplitude']});
C('concentric-squares','Concentric squares','Nested square rings, clipped cleanly to the rectangle.','squares');
C('superellipse','Superellipse rings','Round-to-square loops controlled by the shape exponent.','superellipse',{controls:['detail']});
C('elliptic-rings','Elliptic rings','Simple concentric ellipses with adjustable aspect.','ellipses',{controls:['amplitude']});
const A=(id,n,d,f,o)=>add(id,n,'Radial & guilloché','artwork',d,f,o);
A('guilloche','Guilloché rosette','Layered rosettes create an engraved, interlaced appearance.','guilloche',{featured:true,controls:['detail','amplitude']});
A('archimedean','Archimedean spiral','An expanding spiral study, not a reproduction of the slicer.','spiral');
A('octagram','Octagram spiral','An eight-point radial spiral study, independent of Studio.','octagram',{controls:['amplitude']});
A('spirograph','Spirograph','A hypotrochoid curve creates looping mechanical ornament.','spirograph',{controls:['detail','amplitude']});
A('rose-engine','Rose engine','Multiple polar rose curves form an engraved rosette.','rose',{controls:['detail','amplitude']});
A('lissajous','Lissajous','Two perpendicular oscillations draw interlaced harmonic loops.','lissajous',{controls:['detail','amplitude']});
A('orbital-waves','Orbital waves','An expanding spiral oscillates as it travels outward.','orbital',{controls:['detail','amplitude']});
A('rayburst','Rayburst','Fine radial rays with a quiet circular center.','rays',{controls:['detail','amplitude']});
const O=(id,n,d,f,o)=>add(id,n,'Optical & textile','artwork',d,f,o);
O('crosshatch','Crosshatch','Two perpendicular fine-line families at adjustable crossing angle.','crosshatch',{controls:['amplitude']});
O('moire-lines','Moiré lines','Nearly aligned fine-line families create broad interference bands.','moirelines',{controls:['amplitude']});
O('moire-circles','Moiré circles','Offset ring centers produce a circular interference texture.','moirecircles',{controls:['amplitude']});
O('op-diamonds','Optical diamonds','Nested alternating diamond rings suggest depth.','opdiamonds',{controls:['detail']});
O('halftone-waves','Halftone waves','Dot radii follow a smooth sinusoidal intensity field.','halftone',{controls:['amplitude','detail']});
O('woven-grid','Woven grid','Interrupted horizontal and vertical strands suggest over-and-under weave.','wovengrid',{controls:['detail']});
const N=(id,n,d,f,o)=>add(id,n,'Generative','artwork',d,f,o);
N('hilbert','Hilbert curve','A square space-filling curve, cropped to the artwork rectangle.','hilbert',{controls:['detail']});
N('dragon-curve','Dragon curve','A folded recursive curve forms angular self-similar ornament.','dragon',{controls:['detail']});
N('branching','Branching coral','Seeded recursive branches spread from repeated stems.','branch',{random:true,controls:['detail','amplitude']});
N('cellular','Cellular network','Seeded Voronoi boundaries form an open cellular mesh.','cells',{random:true,controls:['jitter']});
N('phyllotaxis','Phyllotaxis','A golden-angle dot spiral forms interlocking growth spirals.','phyllotaxis',{controls:['amplitude']});
N('constellation','Constellation','Seeded points connect to nearby neighbors in a sparse network.','constellation',{random:true,controls:['detail']});
N('rainfall','Rainfall','Seeded staggered dashes with changing lengths.','rain',{random:true,controls:['jitter']});
N('contour-islands','Contour islands','Small closed height contours form a seeded island field.','islands',{random:true,controls:['detail','jitter']});
// 78 independently selectable pattern algorithms, with reproducible parameters.
function half(poly,a,b,c){let out=[];if(!poly.length)return out;let u=poly.at(-1),du=a*u[0]+b*u[1]+c;for(const v of poly){const dv=a*v[0]+b*v[1]+c;if((du>=-EPS)!==(dv>=-EPS)){const t=du/(du-dv);out.push([mix(u[0],v[0],t),mix(u[1],v[1],t)]);}if(dv>=-EPS)out.push(v);u=v;du=dv;}return out;}
function hullRegular(x,y,r,n,phase=0){return Array.from({length:n},(_,i)=>[x+r*Math.cos(phase+i*TAU/n),y+r*Math.sin(phase+i*TAU/n)]);}
function init(id,input={}){
 const m=registry.find(v=>v.id===id);if(!m)throw Error('Unknown pattern: '+id);
 const num=(k,d,min,max)=>{const v=input[k]===undefined?d:Number(input[k]);if(!Number.isFinite(v)||v<min||v>max)throw Error(k+' out of range');return v;};
 const p={width:num('width',100,1,500),height:num('height',104,1,500),pitch:num('pitch',.62,.15,8),scale:num('scale',1,.25,4),rotation:num('rotation',0,-3600,3600),hatchAngle:num('hatchAngle',0,-3600,3600),stretchX:num('stretchX',1,.35,3),stretchY:num('stretchY',1,.35,3),offsetX:num('offsetX',0,-100,100),offsetY:num('offsetY',0,-100,100),amplitude:num('amplitude',m.defaults.amplitude,0,1),detail:num('detail',m.defaults.detail,2,14),jitter:num('jitter',m.defaults.jitter,0,1),seed:num('seed',1,0,2147483647)|0,symmetry:input.symmetry||'none'};
 const c=Math.cos(p.rotation*PI/180),s=Math.sin(p.rotation*PI/180),ox=p.width*(.5+p.offsetX/100),oy=p.height*(.5+p.offsetY/100);
 p.forward=q=>[ox+q[0]*p.stretchX*c-q[1]*p.stretchY*s,oy+q[0]*p.stretchX*s+q[1]*p.stretchY*c];
 p.angle=a=>Math.atan2(p.stretchY*Math.sin(a*PI/180),p.stretchX*Math.cos(a*PI/180))*180/PI+p.rotation+p.hatchAngle;
 const corners=rect(0,0,p.width,p.height).map(([x,y])=>[((x-ox)*c+(y-oy)*s)/p.stretchX,(-(x-ox)*s+(y-oy)*c)/p.stretchY]);
 p.x0=Math.min(...corners.map(v=>v[0]));p.x1=Math.max(...corners.map(v=>v[0]));p.y0=Math.min(...corners.map(v=>v[1]));p.y1=Math.max(...corners.map(v=>v[1]));
 p.cell=Math.max(3,16*p.scale);p.extent=Math.max(...corners.map(v=>Math.hypot(...v)))+p.cell*2;
 p.random=rng(p.seed);p.meta=m;p.paths=[];p.regions=[];p.notes=[];p.rawPoints=0;
 // Preview budgets are explicit. No output is labeled as a printer path.
 p.step=Math.max(p.pitch,(p.y1-p.y0)/450,(p.x1-p.x0)/450);
 p.path=(points,closed=false)=>{if(points.length<2)return;if(p.rawPoints>220000){if(!p.budget)p.notes.push('Curve generation limited to the preview point budget.');p.budget=true;return;}p.rawPoints+=points.length;p.paths.push({points,closed});};
 p.line=(a,b)=>p.path([a,b]);p.poly=(poly,angle=0)=>{if(poly.length>=3)p.regions.push({polygon:poly,angle});};
 p.arc=(cx,cy,r,a=0,b=TAU)=>{const steps=clamp(Math.ceil(Math.abs(b-a)*r/.6),8,360);p.path(Array.from({length:steps+1},(_,i)=>[cx+r*Math.cos(mix(a,b,i/steps)),cy+r*Math.sin(mix(a,b,i/steps))]));};
 p.grid=(cw,ch,fn)=>{let count=0;const xmin=Math.floor(p.x0/cw)-1,xmax=Math.ceil(p.x1/cw)+1,ymin=Math.floor(p.y0/ch)-1,ymax=Math.ceil(p.y1/ch)+1;for(let j=ymin;j<=ymax;j++)for(let i=xmin;i<=xmax;i++){if(count++>12000)throw Error('Pattern grid exceeds preview budget; increase motif size.');fn((i-.5)*cw,(j-.5)*ch,cw,ch,i,j);}};
 return p;
}
function cells(p,output=true){
 // Jittered lattice with a halo; nearby half-plane tests give exact Voronoi cells.
 const cell=Math.max(p.cell,(Math.max(p.x1-p.x0,p.y1-p.y0))/14), pts=[];
 for(let j=Math.floor(p.y0/cell)-2;j<=Math.ceil(p.y1/cell)+2;j++)for(let i=Math.floor(p.x0/cell)-2;i<=Math.ceil(p.x1/cell)+2;i++)pts.push({x:(i+.5+(hash(i,j,p.seed)-.5)*p.jitter*.85)*cell,y:(j+.5+(hash(i,j,p.seed+8)-.5)*p.jitter*.85)*cell,i,j});
 const box=rect(p.x0-1,p.y0-1,p.x1-p.x0+2,p.y1-p.y0+2), polys=[];
 for(const a of pts){if(a.x<p.x0-cell||a.x>p.x1+cell||a.y<p.y0-cell||a.y>p.y1+cell)continue;let q=box;for(const b of pts){if(a===b||Math.abs(a.i-b.i)>3||Math.abs(a.j-b.j)>3)continue;q=half(q,2*(a.x-b.x),2*(a.y-b.y),b.x*b.x+b.y*b.y-a.x*a.x-a.y*a.y);if(!q.length)break;}if(q.length>2){polys.push(q);if(output)p.poly(q,Math.floor(hash(a.i,a.j,p.seed+17)*6)*30);}}
 return polys;
}
function regional(p){const f=p.meta.algorithm,c=p.cell;
 if(f==='facets'){const h=c*1.05;for(let j=Math.floor(p.y0/h);j<=Math.ceil(p.y1/h);j++){const x=p.x0-1,w=p.x1-p.x0+2,y=j*h;const a=[x,y],b=[x+w,y],d=[x,y+h],e=[x+w,y+h];if(j%2){p.poly([a,b,d],0);p.poly([b,e,d],60);}else{p.poly([a,b,e],60);p.poly([a,e,d],120);}}}
 else if(['basket','quilt','pinwheel','parquet','windmill','offcenter'].includes(f))p.grid(c,c,(x,y,w,h,i,j)=>{
  const a=[x,y],b=[x+w,y],d=[x,y+h],e=[x+w,y+h],k=(i+j)%2;
  if(f==='basket')p.poly([a,b,e,d],k?90:0);
  if(f==='quilt'){const flip=hash(i,j,p.seed)<p.jitter+.1;if(flip){p.poly([a,b,d],30);p.poly([b,e,d],120);}else{p.poly([a,b,e],0);p.poly([a,e,d],90);}}
  if(f==='pinwheel'||f==='offcenter'){const t=f==='offcenter'?p.jitter*.7:0,center=[x+w*(.5+(hash(i,j,p.seed)-.5)*t),y+h*(.5+(hash(i,j,p.seed+1)-.5)*t)];[[a,b],[b,e],[e,d],[d,a]].forEach(([u,v],n)=>p.poly([u,v,center],n*45+(k?30:0)));}
  if(f==='parquet'){const n=Math.round(p.detail/2)+1;for(let k=0;k<n;k++)p.poly((i+j)%2?rect(x+k*w/n,y,w/n,h):rect(x,y+k*h/n,w,h/n),((i+j)%2?90:0)+k%2*12);}
  if(f==='windmill'){const a=w/3;p.poly(rect(x,y,2*a,a),0);p.poly(rect(x+2*a,y,a,2*a),90);p.poly(rect(x+a,y+2*a,2*a,a),0);p.poly(rect(x,y+a,a,2*a),90);p.poly(rect(x+a,y+a,a,a),45);}
 });
 else if(f==='brick'||f==='tatami')p.grid(c*1.6,c*.55,(x,y,w,h,i,j)=>{x+=(j%2)*w/2;p.poly(rect(x,y,w,h),f==='tatami'?((i+j)%2?90:0):((i-j)%3)*30);});
 else if(f==='bands'){for(let k=Math.floor((p.y0-p.x1)/c)-1;k<Math.ceil((p.y1-p.x0)/c)+1;k++){let q=rect(p.x0,p.y0,p.x1-p.x0,p.y1-p.y0);q=half(q,-1,1,-k*c);q=half(q,1,-1,(k+1)*c);p.poly(q,k%2?45:135);}}
 else if(f==='chevron'){for(const side of [-1,1]){let box=half(rect(p.x0,p.y0,p.x1-p.x0,p.y1-p.y0),side,0,0),slope=side*(.2+p.amplitude);const vals=box.map(q=>q[1]-slope*q[0]);if(!vals.length)continue;for(let k=Math.floor(Math.min(...vals)/c)-1;k<=Math.ceil(Math.max(...vals)/c)+1;k++){let q=half(box,-slope,1,-k*c);q=half(q,slope,-1,(k+1)*c);p.poly(q,Math.atan(slope)*180/PI+(k%2?90:0));}}}
 else if(f==='strips'){let x=Math.floor(p.x0/c)*c;let k=0;while(x<p.x1){const w=c*(1+(hash(k++,0,p.seed)-.5)*p.jitter*1.5);p.poly(rect(x,p.y0,w,p.y1-p.y0),90+(hash(k,3,p.seed)-.5)*50);x+=w;}}
 else if(f==='voronoi')cells(p);
 else if(f==='fracture')p.grid(c,c,(x,y,w,h,i,j)=>{const pt=(a,b)=>[a*c+(hash(a,b,p.seed)-.5)*c*p.jitter*.7,b*c+(hash(a,b,p.seed+7)-.5)*c*p.jitter*.7];const a=pt(i,j),b=pt(i+1,j),e=pt(i+1,j+1),d=pt(i,j+1);p.poly([a,b,e],Math.floor(hash(i,j,p.seed+12)*6)*30);p.poly([a,e,d],Math.floor(hash(i,j,p.seed+21)*6)*30);});
 else if(f==='diamonds'){
  // Rotate a full square lattice 45 degrees in generator space.
  const e=p.extent,step=c*.8;for(let j=-Math.ceil(e/step);j<=Math.ceil(e/step);j++)for(let i=-Math.ceil(e/step);i<=Math.ceil(e/step);i++){const q=rect(i*step,j*step,step,step).map(([x,y])=>[(x-y)/Math.SQRT2,(x+y)/Math.SQRT2]);p.poly(q,(i+j)%2?45:135);}
 }
 else if(f==='triangles'){const h=c*Math.sqrt(3)/2;p.grid(c,h,(x,y,w,h,i,j)=>{const s=(j%2)*w/2;x+=s;p.poly([[x,y],[x+w,y],[x+w/2,y+h]],((i+j)%3)*60);p.poly([[x+w,y],[x+w*1.5,y+h],[x+w/2,y+h]],((i+j+1)%3)*60);});}
 else if(f==='hex'||f==='cubes'){const r=c*.55,hw=Math.sqrt(3)*r;p.grid(hw,1.5*r,(x,y,w,h,i,j)=>{x+=(j%2)*w/2;const poly=hullRegular(x,y,r,6,PI/6);if(f==='hex')p.poly(poly,((i-j)%3)*60);else for(let k=0;k<3;k++)p.poly([[x,y],poly[k*2],poly[(k*2+1)%6],poly[(k*2+2)%6]],k*60);});}
 else if(f==='sunburst'){const n=Math.round(p.detail)+4,r=c*(.2+p.amplitude*.8),outer=p.extent*3;const hub=hullRegular(0,0,r,n);p.poly(hub,0);for(let i=0;i<n;i++){const a=i*TAU/n,b=(i+1)*TAU/n;p.poly([[r*Math.cos(a),r*Math.sin(a)],[outer*Math.cos(a),outer*Math.sin(a)],[outer*Math.cos(b),outer*Math.sin(b)],[r*Math.cos(b),r*Math.sin(b)]],(a+b)*90/PI);}}
 else if(f==='frames'){const n=Math.ceil(p.extent/c);p.poly(rect(-c/2,-c/2,c,c),45);for(let k=0;k<n;k++){const a=c/2+k*c,b=a+c;const inner=rect(-a,-a,2*a,2*a),outer=rect(-b,-b,2*b,2*b);for(let j=0;j<4;j++)p.poly([inner[j],outer[j],outer[(j+1)%4],inner[(j+1)%4]],j%2?90:0);}}
}
function tiled(p){const f=p.meta.algorithm,c=p.cell,n=Math.round(p.detail),cx=(pts)=>p.path(pts,true);
 if(f==='mesh'){for(let k=Math.floor((p.y0-p.x1)/c)-1;k<=Math.ceil((p.y1-p.x0)/c)+1;k++)p.line([p.x0,p.x0+k*c],[p.x1,p.x1+k*c]);for(let k=Math.floor((p.y0+p.x0)/c)-1;k<=Math.ceil((p.y1+p.x1)/c)+1;k++)p.line([p.x0,-p.x0+k*c],[p.x1,-p.x1+k*c]);return;}
 if(f==='hemp'||f==='hexrings'){const r=c*.6,hw=Math.sqrt(3)*r;p.grid(hw,1.5*r,(x,y,w,h,i,j)=>{x+=(j%2)*w/2;const outer=hullRegular(x,y,r,6,PI/6);if(f==='hexrings'){for(let k=1;k<=n;k++)cx(hullRegular(x,y,r*k/(n+1),6,PI/6));}else{cx(outer);for(let k=0;k<6;k++){const a=outer[k],b=outer[(k+1)%6],mid=[mix(a[0],b[0],.5),mix(a[1],b[1],.5)],q=[mix(x,mid[0],.68),mix(y,mid[1],.68)];p.line([x,y],a);p.line(a,q);p.line(q,b);p.line([x,y],q);}}});return;}
 if(f==='scales'||f==='fans'){p.grid(c,c*.5,(x,y,w,h,i,j)=>{x+=(j%2)*w/2;const r=c*.48;if(f==='scales')for(let k=1;k<=n;k++)p.arc(x,y,r*k/n,PI,TAU);else{p.arc(x,y,r,PI,TAU);for(let k=0;k<=n;k++)p.line([x,y],[x+r*Math.cos(PI+k*PI/n),y+r*Math.sin(PI+k*PI/n)]);}});return;}
 p.grid(c,c,(x,y,w,h,i,j)=>{
  const mx=x+w/2,my=y+h/2,r=c*.46;
  if(f==='linked'){p.arc(x,y,c*.7);}
  if(f==='fret'){const pts=[];let d=r;for(let k=0;k<n;k++){pts.push([mx-d,my-d],[mx+d,my-d],[mx+d,my+d],[mx-d,my+d]);d-=r/(n+1);pts.push([mx-d-r/(n+1),my-d]);}p.path(pts);}
  if(f==='diamondrings')for(let k=1;k<=n;k++)cx(hullRegular(mx,my,r*k/n,4));
  if(f==='trianglerings'){for(let k=1;k<=n;k++)cx(hullRegular(mx,my,r*k/n,3,-PI/2+(i+j)%2*PI));}
  if(f==='arcade'){for(let k=1;k<=n;k++){const rr=r*k/n;p.arc(mx,my,rr,PI,TAU);p.line([mx-rr,my],[mx-rr,y+h*.96]);p.line([mx+rr,my],[mx+rr,y+h*.96]);}}
  if(f==='stitch'){p.line([x+c*.2,y+c*.2],[x+c*.8,y+c*.8]);p.line([x+c*.8,y+c*.2],[x+c*.2,y+c*.8]);}
  if(f==='startiles'){cx(Array.from({length:16},(_,k)=>{const t=k*TAU/16,rr=k%2?r*(.35+p.amplitude*.45):r;return[mx+rr*Math.cos(t),my+rr*Math.sin(t)];}));cx(hullRegular(x,y,c*.12,4));}
  if(['truchet','ribbontruchet'].includes(f)){const flip=hash(i,j,p.seed)>.5;const corners=flip?[[x+w,y,PI/2,PI],[x,y+h,-PI/2,0]]:[[x,y,0,PI/2],[x+w,y+h,PI,PI*1.5]];const count=f==='truchet'?1:n;for(const [ax,ay,a,b]of corners)for(let k=0;k<count;k++)p.arc(ax,ay,w*(.5+(k-(count-1)/2)*.65/(count+1)),a,b);}
  if(f==='diagtruchet'||f==='triangletruchet'){const flip=hash(i,j,p.seed)>.5;for(let k=1;k<=n;k++){const t=k/(n+1);if(f==='diagtruchet'){p.line(flip?[x,y+h*t]:[x+w,y+h*t],flip?[x+w*t,y]:[x+w*(1-t),y]);p.line(flip?[x+w,y+h*t]:[x,y+h*t],flip?[x+w*t,y+h]:[x+w*(1-t),y+h]);}else{const pts=[[x,y+h*t],[x+w*t,y+h*t],[x+w*t,y]];p.path(flip?pts.map(q=>[x+w-(q[0]-x),q[1]]):pts);}}}
  if(f==='labyrinth'){const flip=hash(i,j,p.seed)>.5;for(let k=0;k<n;k++){const a=(k+.5)*w/n;p.path(flip?[[x+a,y],[x+a,y+a],[x+w,y+a]]:[[x,y+a],[x+a,y+a],[x+a,y+h]]);}}
  if(f==='circuittiles'){for(let k=1;k<=Math.max(2,n/2);k++){const a=k/(Math.max(2,n/2)+1),flip=hash(i*19+k,j,p.seed)>.5;const q=flip?[[x,y+h*a],[x+w*a,y+h*a],[x+w*a,y+h]]:[[x+w,y+h*a],[x+w*a,y+h*a],[x+w*a,y]];p.path(q);p.arc(q[1][0],q[1][1],c*.03);}}
 });
}
function waves(p){const f=p.meta.algorithm,c=p.cell,amp=c*p.amplitude*.32,phase=hash(3,7,p.seed)*TAU;
 if(f==='interference'){const offset=c*(.25+p.amplitude*1.5);for(const x of [-offset,offset])for(let r=p.step;r<p.extent+offset;r+=p.step)p.arc(x,0,r);return;}
 if(f==='stream'){const delta=Math.max(.65,p.pitch),starts=Math.min(220,Math.ceil((p.y1-p.y0)/p.step));for(let k=0;k<=starts;k++){let x=p.x0-c,y=mix(p.y0-c,p.y1+c,k/starts),pts=[[x,y]];for(let j=0;j<Math.min(700,(p.x1-p.x0+2*c)/delta);j++){const a=(noise(x/(c*(.8+p.detail*.18)),y/(c*(.8+p.detail*.18)),p.seed)-.5)*p.amplitude*2.4+Math.sin(y/(c*2))*p.amplitude*.3;x+=delta*Math.cos(a);y+=delta*Math.sin(a);pts.push([x,y]);}p.path(pts);}return;}
 const reps=f==='wovenwaves'||f==='braid'?2:1;
 for(let layer=0;layer<reps;layer++){
 const vertical=f==='wovenwaves'&&layer===1,x0=vertical?p.y0:p.x0,x1=vertical?p.y1:p.x1,y0=vertical?p.x0:p.y0,y1=vertical?p.x1:p.y1;
 const step=Math.max(p.step,(y1-y0+4*amp)/400),samples=clamp(Math.ceil((x1-x0)/(c/35)),20,440);
 for(let y=Math.floor((y0-2*amp)/step)*step;y<=y1+2*amp;y+=step){const pts=[];for(let k=0;k<=samples;k++){const x=mix(x0,x1,k/samples),t=x*TAU/(c*1.5)+phase;let z=0;
 if(f==='waves'||f==='wovenwaves')z=amp*Math.sin(t);
 if(f==='harmonic')z=amp*(Math.sin(t)+.3*Math.sin(t*(2+Math.floor(p.detail/4))+.7));
 if(f==='braid')z=amp*Math.sin(t+(layer?PI:0));
 if(f==='chevronlines')z=amp*2/PI*Math.asin(Math.sin(t));
 if(f==='accordion')z=amp*Math.sin(t+2*Math.sin(t*.2));
 if(f==='pulse')z=amp*Math.tanh(3*Math.sin(t));
 if(f==='dunes')z=amp*2.6*(noise(x/(c*1.3),y/(c*4),p.seed)-.5)+amp*p.jitter*Math.sin(t*.7+y/c);
 pts.push(vertical?[y+z,x]:[x,y+z]);}p.path(pts);}}
}
function contours(p){const f=p.meta.algorithm,c=p.cell,phase=hash(5,6,p.seed)*TAU;
 if(f==='topo'||f==='islands'){march(p,f==='islands');return;}
 const maxR=p.extent*(f==='wood'?2.5:1.5),step=Math.max(p.step*p.scale,maxR/280),samples=220;
 for(let r=step;r<maxR;r+=step){const pts=[];if(f==='squares'){p.path(rect(-r,-r,2*r,2*r),true);continue;}
 for(let k=0;k<=samples;k++){const t=k*TAU/samples;let rr=r,x,y;
 if(f==='organic'||f==='agate'||f==='wood')rr=r*(1+p.amplitude*.21*Math.sin((f==='agate'?8:3)*t+phase)+p.amplitude*.07*Math.sin(p.detail*t-phase));
 if(f==='superellipse'){const n=1+p.detail*.38;x=r*Math.sign(Math.cos(t))*Math.abs(Math.cos(t))**(2/n);y=r*Math.sign(Math.sin(t))*Math.abs(Math.sin(t))**(2/n);}
 else{x=rr*Math.cos(t);y=rr*Math.sin(t);}
 if(f==='wood'){x*=.38;y*=1.4;x+=Math.sin(y/c*.6)*c*p.amplitude*.2;}
 if(f==='fingerprint'){x*=.58;y*=1.35;x+=p.amplitude*c*.4*Math.sin(t)*Math.exp(-r/(c*3));}
 if(f==='ellipses')x*=.35+p.amplitude*1.3;
 pts.push([x,y]);}p.path(pts);}
}
function march(p,islands){
 const cell=p.cell,spacing=Math.max(.8,cell/10,(p.x1-p.x0)/150,(p.y1-p.y0)/150),nx=Math.ceil((p.x1-p.x0)/spacing)+1,ny=Math.ceil((p.y1-p.y0)/spacing)+1;
 const val=(x,y)=>noise(x/cell,y/cell,p.seed)+p.jitter*.45*noise(x/cell*2.1,y/cell*2.1,p.seed+13);
 const grid=Array.from({length:ny+1},(_,j)=>Array.from({length:nx+1},(_,i)=>val(p.x0+i*spacing,p.y0+j*spacing)));
 const levels=Math.round(p.detail)+3;
 for(let l=0;l<levels;l++){const level=(islands?.57:.15)+l*(islands?.33:.8)/levels;
 for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
 const xy=[[p.x0+i*spacing,p.y0+j*spacing],[p.x0+(i+1)*spacing,p.y0+j*spacing],[p.x0+(i+1)*spacing,p.y0+(j+1)*spacing],[p.x0+i*spacing,p.y0+(j+1)*spacing]],v=[grid[j][i],grid[j][i+1],grid[j+1][i+1],grid[j+1][i]],edges=[];
 for(let k=0;k<4;k++){const h=(k+1)%4;if((v[k]>=level)!==(v[h]>=level)){const t=(level-v[k])/(v[h]-v[k]);edges.push([mix(xy[k][0],xy[h][0],t),mix(xy[k][1],xy[h][1],t)]);}}
 if(edges.length===2)p.line(...edges);else if(edges.length===4){const center=v.reduce((a,b)=>a+b,0)/4;if((center>=level)===(v[0]>=level)){p.line(edges[0],edges[1]);p.line(edges[2],edges[3]);}else{p.line(edges[0],edges[3]);p.line(edges[1],edges[2]);}}
 }}
}
function radial(p){const f=p.meta.algorithm,c=p.cell,n=Math.round(p.detail),rmax=p.extent*1.3;
 if(['spiral','octagram','orbital'].includes(f)){const turns=rmax/Math.max(p.step*p.scale,.3),steps=Math.min(65000,Math.ceil(turns*170)),pts=[];for(let k=0;k<=steps;k++){const t=k/steps*turns*TAU;let r=k/steps*rmax;if(f==='octagram')r*=1+p.amplitude*.2*Math.cos(8*t);if(f==='orbital')r+=p.amplitude*c*.15*Math.sin(t*n);pts.push([r*Math.cos(t),r*Math.sin(t)]);}p.path(pts);return;}
 if(f==='rays'){const inner=c*p.amplitude*.6,count=60+n*25;for(let k=0;k<count;k++){const t=k*TAU/count;p.line([inner*Math.cos(t),inner*Math.sin(t)],[rmax*Math.cos(t),rmax*Math.sin(t)]);}return;}
 if(f==='guilloche'||f==='rose'){for(let j=1;j<=Math.min(180,Math.ceil(rmax/(p.step*p.scale)));j++){const base=j*Math.max(p.step*p.scale,rmax/180),pts=[];for(let k=0;k<=400;k++){const t=k*TAU/400,r=base*(1+p.amplitude*(f==='rose'?.36:.18)*Math.sin(n*t+j*.13));pts.push([r*Math.cos(t),r*Math.sin(t)]);}p.path(pts);}return;}
 if(f==='spirograph'){p.grid(c*3,c*3,(x,y,w,h)=>{for(let j=0;j<3;j++){const a=c*(.78+j*.04),b=a/(n+.5),d=b*(1+p.amplitude*4),pts=[];for(let k=0;k<=2000;k++){const t=k/2000*TAU*2;pts.push([x+w/2+(a-b)*Math.cos(t)+d*Math.cos((a-b)/b*t),y+h/2+(a-b)*Math.sin(t)-d*Math.sin((a-b)/b*t)]);}p.path(pts);}});return;}
 if(f==='lissajous'){p.grid(c*3,c*3,(x,y,w,h)=>{for(let j=0;j<3;j++){const pts=[];for(let k=0;k<=2000;k++){const t=k*TAU/2000;pts.push([x+w/2+w*.46*Math.sin(n*t+p.amplitude*PI+j*.1),y+h/2+h*.46*Math.sin((n+1)*t)]);}p.path(pts);}});}
}
function optical(p){const f=p.meta.algorithm,c=p.cell;
 if(f==='crosshatch'||f==='moirelines'){
  const angle=f==='crosshatch'?30+p.amplitude*100:1+p.amplitude*12;
  for(const a of [0,angle*PI/180])for(let k=-Math.ceil(p.extent/(p.step*p.scale));k<=Math.ceil(p.extent/(p.step*p.scale));k++){const b=k*p.step*p.scale,co=Math.cos(a),si=Math.sin(a);p.line([-p.extent*co-b*si,-p.extent*si+b*co],[p.extent*co-b*si,p.extent*si+b*co]);}return;
 }
 if(f==='moirecircles'){for(const x of [-c*p.amplitude,c*p.amplitude])for(let r=p.step;r<p.extent*1.6;r+=Math.max(p.step,p.extent/230))p.arc(x,0,r);return;}
 if(f==='opdiamonds'){p.grid(c,c,(x,y,w,h,i,j)=>{const n=Math.round(p.detail);for(let k=1;k<=n;k++)p.path(hullRegular(x+w/2,y+h/2,w*.66*k/(n+1),4,(i+j)%2?PI/4:0),true);});return;}
 if(f==='halftone'){const step=c/5;p.grid(step,step,(x,y,w,h)=>{const a=(1+Math.sin(x/c*TAU*(.5+p.detail/6)+p.amplitude*3*Math.sin(y/c)))/2;p.arc(x,y,step*(.08+.34*a));});return;}
 if(f==='wovengrid'){p.grid(c,c,(x,y,w,h,i,j)=>{const n=Math.round(p.detail);for(let k=0;k<n;k++){const t=(k+.5)/n,along=(i+j)%2===0;p.line(along?[x,y+h*t]:[x+w*t,y],along?[x+w,y+h*t]:[x+w*t,y+h]);if(along){p.line([x+w*t,y],[x+w*t,y+h*.18]);p.line([x+w*t,y+h*.82],[x+w*t,y+h]);}else{p.line([x,y+h*t],[x+w*.18,y+h*t]);p.line([x+w*.82,y+h*t],[x+w,y+h*t]);}}});}
}
function hilbertPoint(order,t){let x=0,y=0;for(let s=1;s<2**order;s*=2){const rx=(t>>1)&1,ry=(t^rx)&1;if(!ry){if(rx){x=s-1-x;y=s-1-y;}[x,y]=[y,x];}x+=s*rx;y+=s*ry;t>>=2;}return[x,y];}
function generative(p){const f=p.meta.algorithm,c=p.cell,n=Math.round(p.detail);
 if(f==='hilbert'){const order=clamp(Math.round(n/2)+2,3,7),count=2**order,step=Math.max(p.step,c/15),size=count*step;const pts=[];for(let k=0;k<count*count;k++){const q=hilbertPoint(order,k);pts.push([(q[0]+.5)*step-size/2,(q[1]+.5)*step-size/2]);} // Tile curve squares to avoid empty corners after rotation.
 p.grid(size,size,(x,y)=>p.path(pts.map(q=>[q[0]+x+size/2,q[1]+y+size/2])));return;}
 if(f==='dragon'){let pts=[[0,0],[1,0]];for(let i=0;i<Math.min(14,n+5);i++){const pivot=pts.at(-1),tail=[];for(let j=pts.length-2;j>=0;j--)tail.push([pivot[0]-(pts[j][1]-pivot[1]),pivot[1]+(pts[j][0]-pivot[0])]);pts.push(...tail);}const xs=pts.map(q=>q[0]),ys=pts.map(q=>q[1]),a=Math.min(...xs),b=Math.min(...ys),w=Math.max(...xs)-a,h=Math.max(...ys)-b,size=c*3;const scale=size/Math.max(w,h);p.grid(size,size,(x,y)=>p.path(pts.map(q=>[x+(q[0]-a)*scale,y+(q[1]-b)*scale])));return;}
 if(f==='branch'){function branch(x,y,l,a,d){if(d<=0)return;const q=[x+l*Math.cos(a),y+l*Math.sin(a)];p.line([x,y],q);const delta=.2+p.amplitude*.8;branch(...q,l*.72,a-delta+(p.random()-.5)*.15,d-1);branch(...q,l*.69,a+delta+(p.random()-.5)*.15,d-1);}p.grid(c*2,c*3,(x,y,w,h)=>branch(x+w/2,y+h,c*.9,-PI/2,Math.min(8,Math.round(n/2)+2)));return;}
 if(f==='cells'){const seen=new Set();for(const poly of cells(p,false)){for(let k=0;k<poly.length;k++){const a=poly[k],b=poly[(k+1)%poly.length],key=[a.map(v=>v.toFixed(3)).join(','),b.map(v=>v.toFixed(3)).join(',')].sort().join(';');if(!seen.has(key)){seen.add(key);p.line(a,b);}}}return;}
 if(f==='phyllotaxis'){const golden=PI*(3-Math.sqrt(5)),spacing=c*.1,count=Math.min(4000,Math.ceil((p.extent/spacing)**2));for(let k=1;k<count;k++){const r=spacing*Math.sqrt(k),t=k*golden;p.arc(r*Math.cos(t),r*Math.sin(t),spacing*(.15+p.amplitude*.32));}return;}
 if(f==='constellation'){const points=[];p.grid(c,c,(x,y,w,h,i,j)=>points.push([x+hash(i,j,p.seed)*w,y+hash(i,j,p.seed+9)*h]));const max=Math.min(points.length,800);for(let i=0;i<max;i++){const a=points[i];p.arc(...a,c*.035);let near=points.map((b,k)=>({k,d:Math.hypot(a[0]-b[0],a[1]-b[1])})).filter(v=>v.k!==i&&v.d<c*1.9).sort((a,b)=>a.d-b.d).slice(0,Math.max(1,Math.floor(n/3)));for(const q of near)if(q.k>i)p.line(a,points[q.k]);}return;}
 if(f==='rain'){p.grid(c*.3,c*.65,(x,y,w,h,i,j)=>{const t=hash(i,j,p.seed),len=h*(.15+t*.75),xx=x+w*(.5+(hash(i,j,p.seed+8)-.5)*p.jitter);p.line([xx,y],[xx,y+len]);});return;}
 if(f==='islands')march(p,true);
}
function hatch(poly,angle,pitch){const t=angle*PI/180,d=[Math.cos(t),Math.sin(t)],n=[-d[1],d[0]],proj=poly.map(q=>q[0]*n[0]+q[1]*n[1]),lo=Math.min(...proj),hi=Math.max(...proj),paths=[],extent=3000;for(let k=Math.ceil((lo+EPS)/pitch);k*pitch<hi-EPS;k++){const v=k*pitch,a=[n[0]*v-d[0]*extent,n[1]*v-d[1]*extent],b=[n[0]*v+d[0]*extent,n[1]*v+d[1]*extent],line=G.clipSegmentPolygon(a,b,poly);if(line)paths.push({points:line,closed:false,angle});}return paths;}
function mirror(data,p){const mx=p.symmetry==='mirror-x'||p.symmetry==='quad',my=p.symmetry==='mirror-y'||p.symmetry==='quad';if(!mx&&!my)return data;
 const box=rect(0,0,mx?p.width/2:p.width,my?p.height/2:p.height),paths=[],regions=[];
 for(const sx of (mx?[1,-1]:[1]))for(const sy of (my?[1,-1]:[1])){
 const map=q=>[sx===1?q[0]:p.width-q[0],sy===1?q[1]:p.height-q[1]];
 for(const path of data.paths){const pts=path.closed?[...path.points,path.points[0]]:path.points;for(const run of G.clipPolyline(pts,box))paths.push({...path,points:run.map(map),closed:false});}
 for(const r of data.regions){let poly=r.polygon;if(mx)poly=half(poly,-1,0,p.width/2);if(my)poly=half(poly,0,-1,p.height/2);if(poly.length>2&&Math.abs(G.area(poly))>EPS)regions.push({...r,polygon:poly.map(map),angle:Math.atan2(sy*Math.sin(r.angle*PI/180),sx*Math.cos(r.angle*PI/180))*180/PI});}}
 return {paths,regions};}
const cache=new Map();
function generate(id,input={}){
 const key=id+JSON.stringify(input);if(cache.has(key))return cache.get(key);
 const p=init(id,input),m=p.meta;
 if(m.kind==='regional')regional(p);else if(['Lattices & tiles','Truchet & mazes'].includes(m.family))tiled(p);else if(m.family==='Waves & flow')waves(p);else if(m.family==='Contours & grain')contours(p);else if(m.family==='Radial & guilloché')radial(p);else if(m.family==='Optical & textile')optical(p);else generative(p);
 let data={paths:[],regions:[]},box=rect(0,0,p.width,p.height);
 for(const r of p.regions){const poly=G.clipPolygon(r.polygon.map(p.forward),p.width,p.height);if(poly.length>2&&Math.abs(G.area(poly))>EPS)data.regions.push({polygon:poly,angle:((p.angle(r.angle)%180)+180)%180});}
 for(const path of p.paths){const points=(path.closed?[...path.points,path.points[0]]:path.points).map(p.forward);for(const run of G.clipPolyline(points,box))data.paths.push({points:run,closed:false});}
 data=mirror(data,p);
 data.regions.forEach((r,i)=>{r.id=i;data.paths.push(...hatch(r.polygon,r.angle,p.pitch).map(q=>({...q,region:i})));});
 let total=data.paths.reduce((s,v)=>s+v.points.length,0);const MAX_POINTS=100000;
 if(total>MAX_POINTS){let used=0;const stride=Math.ceil(total/MAX_POINTS);data.paths=data.paths.filter((path,i)=>{if(i%stride===0&&used+path.points.length<=MAX_POINTS){used+=path.points.length;return true;}return false;});p.notes.push('Visual line density reduced to the 100,000-point budget; full region polygons are retained.');}
 for(const path of data.paths)for(const q of path.points){if(!q.every(Number.isFinite))throw Error('Non-finite path point');q[0]=clamp(q[0],0,p.width);q[1]=clamp(q[1],0,p.height);}
 const parameters=Object.fromEntries(['width','height','pitch','scale','rotation','hatchAngle','stretchX','stretchY','offsetX','offsetY','amplitude','detail','jitter','seed','symmetry'].map(k=>[k,p[k]]));
 const out={...data,id,name:m.name,kind:m.kind,family:m.family,parameters,pointCount:data.paths.reduce((s,v)=>s+v.points.length,0),notes:[...p.notes,m.kind==='regional'?'Complete directional-region design; requires a modifier adapter and slicer validation.':'Decorative curves; intersections, gaps, bead spacing and extrusion are not manufacturing-validated.']};
 if(cache.size>=12)cache.delete(cache.keys().next().value);cache.set(key,out);return out;
}
function clipData(data,box,layer=0){const paths=[],regions=[];for(const path of data.paths)for(const run of G.clipPolyline(path.points,box))paths.push({...path,points:run,layer});for(const r of data.regions){let poly=r.polygon;for(let i=0;i<box.length;i++){const a=box[i],b=box[(i+1)%box.length];poly=half(poly,-(b[1]-a[1]),b[0]-a[0],(b[1]-a[1])*a[0]-(b[0]-a[0])*a[1]);}if(poly.length>2&&Math.abs(G.area(poly))>EPS)regions.push({...r,polygon:poly,layer});}return {paths,regions};}
function compose(id,input,secondId,mode='single',ratio=.5,secondRotation=90){const a=generate(id,input);if(mode==='single'||!secondId)return a;
 const b=generate(secondId,{...input,rotation:(input.rotation||0)+secondRotation}),w=input.width,h=input.height;ratio=clamp(ratio,.1,.9);let aa,bb;
 if(mode==='overlay'){aa={paths:a.paths.map(q=>({...q,layer:0})),regions:[]};bb={paths:b.paths.map(q=>({...q,layer:1})),regions:[]};}
 else {const vertical=mode==='split-x',r=vertical?w*ratio:h*ratio;aa=clipData(a,vertical?rect(0,0,r,h):rect(0,0,w,r),0);bb=clipData(b,vertical?rect(r,0,w-r,h):rect(0,r,w,h-r),1);}
 const regional=mode!=='overlay'&&a.kind==='regional'&&b.kind==='regional';const regions=regional?[...aa.regions,...bb.regions].map((r,i)=>({...r,id:i})):[];
 return {...a,name:a.name+' + '+b.name,kind:regional?'regional':'artwork',paths:[...aa.paths,...bb.paths],regions,pointCount:a.pointCount+b.pointCount,layers:{mode,ratio,secondId,secondRotation},notes:[...a.notes,...b.notes,mode==='overlay'?'Overlay is artwork only: no non-overlapping modifier partition is exported.':'Two designs are clipped into non-overlapping parts of the artwork rectangle.']};}
root.ZudoPatterns={version:'2.0.0',metadata:registry,generate,compose,geometry:{...G,half,rect,hatch},rng,MAX_POINTS:100000};
})(typeof globalThis==='undefined'?this:globalThis);