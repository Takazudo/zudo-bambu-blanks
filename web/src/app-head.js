(function(){
  'use strict';
  const D=window.ZUDO_DATA,P=window.ZudoPatterns,C=window.ZudoSurfaceCore,T=window.THREE;
  const $=id=>document.getElementById(id);
  const DEFAULT={panelId:'cad-3u-20hp',patternId:'pinwheel',thickness:2,endZone:12.25,sideInset:2,pitch:.62,scale:1,rotation:0,color:'#bd8551',lightAngle:35,sheen:65,showZones:true,view:'angle',image:null,imageFit:'cover',imageZoom:1,imageOffsetX:0,imageOffsetY:0,amplitude:.45,detail:6,jitter:.3,seed:17,stretchX:1,stretchY:1,offsetX:0,offsetY:0,hatchAngle:0,symmetry:'none',renderStyle:'satin',strokeRatio:.7,compositionMode:'single',secondaryPattern:'wave-field',secondaryRotation:90,splitRatio:.5,overlayOpacity:.45};
  const state={...DEFAULT};

  let study,renderer,scene,camera,controls,panelMesh,edgeMesh,zoneLine,frontMaterial,sideMaterial,texture,light,observer;
  let dirty=false,renderPending=false,geometryKey='',importSerial=0,toastTimer;
  const textureCanvas=document.createElement('canvas');
  const history=[],future=[];let historyTimer,libraryFamily='Featured',librarySerial=0,variationSerial=0,variationMode='variations',variationStates=[],lastThumb='',savedDesigns=[],favorites=new Set();
  const thumbnails=new Map();
  try{favorites=new Set(JSON.parse(localStorage.getItem('zudo-surface-favorites-v2')||'[]'));savedDesigns=JSON.parse(localStorage.getItem('zudo-surface-designs-v2')||'[]');if(!Array.isArray(savedDesigns))savedDesigns=[];}catch(e){savedDesigns=[];}
  const panel=()=>D.presets.find(p=>p.id===state.panelId);
  const name=()=>study?.pattern?.name||(state.image?state.image.name:P.metadata.find(p=>p.id===state.patternId).name);
  function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,3400);}
  function requestRender(){if(!renderer||renderPending)return;renderPending=true;requestAnimationFrame(()=>{renderPending=false;renderer.render(scene,camera);});}
  function schedule(){if(dirty)return;dirty=true;requestAnimationFrame(()=>{dirty=false;refresh();});}
  function bindRange(id,key,cast=Number){$(id).addEventListener('input',event=>{state[key]=cast(event.target.value);schedule();});}
  function applyView(view){
    state.view=renderer?view:'flat';
    $('modelView').hidden=state.view==='flat';$('flatView').hidden=state.view!=='flat';
    $('viewAngle').setAttribute('aria-pressed',String(state.view==='angle'));$('viewFlat').setAttribute('aria-pressed',String(state.view==='flat'));
    $('interactionHint').textContent=state.view==='flat'?'Finished-face view · dimensions in millimeters':'Drag to orbit · Scroll to zoom · Right-drag to pan';
    if(state.view==='flat'&&study)$('flatView').innerHTML=C.svg(study);else{resize();requestRender();}
  }
  function fit(){
    if(!camera||!controls)return;
    const p=panel(),aspect=camera.aspect;
    const compact=$('stage').getBoundingClientRect().width<650;
    const distance=Math.max(p.height,p.width/Math.max(.3,aspect))/(2*Math.tan(camera.fov*Math.PI/360))*(compact?1.62:1.44);
    controls.target.set(0,compact?10:0,0);camera.position.set(distance*.34,controls.target.y+distance*.13,distance);
    controls.minDistance=40;controls.maxDistance=1500;controls.update();requestRender();
  }
  function resize(){
    if(!renderer)return;
    const bounds=$('stage').getBoundingClientRect();
    renderer.setSize(Math.max(1,bounds.width),Math.max(1,bounds.height),false);camera.aspect=Math.max(1,bounds.width)/Math.max(1,bounds.height);camera.updateProjectionMatrix();requestRender();
  }
  function initialize3D(){
    try{
      renderer=new T.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true});
      renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.75));
      renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
      renderer.domElement.setAttribute('aria-label','Orbitable panel surface model');renderer.domElement.tabIndex=0;$('modelView').appendChild(renderer.domElement);
      scene=new T.Scene();camera=new T.PerspectiveCamera(32,1,.1,4000);camera.up.set(0,1,0);
      controls=new window.OrbitControls(camera,renderer.domElement);controls.enableDamping=false;controls.addEventListener('change',requestRender);
      const pmrem=new T.PMREMGenerator(renderer),room=new window.RoomEnvironment();
      scene.environment=pmrem.fromScene(room,.04).texture;room.dispose();pmrem.dispose();
      scene.add(new T.HemisphereLight(0xffffff,0x485765,1.25));
      light=new T.DirectionalLight(0xfff4df,2.2);light.position.set(100,80,200);scene.add(light);
      const fill=new T.DirectionalLight(0xdbeaff,1.2);fill.position.set(-130,-60,90);scene.add(fill);
      texture=new T.CanvasTexture(textureCanvas);texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
      frontMaterial=new T.MeshStandardMaterial({map:texture,metalness:.28,roughness:.4,envMapIntensity:.6});
      sideMaterial=new T.MeshStandardMaterial({color:state.color,metalness:.25,roughness:.44});
      observer=new ResizeObserver(()=>{resize();});observer.observe($('stage'));resize();fit();
      renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();$('webglNotice').hidden=false;applyView('flat');});
    }catch(error){
      if(renderer)renderer.dispose();renderer=null;$('modelView').replaceChildren();$('webglNotice').hidden=false;$('viewAngle').disabled=true;
    }
  }
  function updateModel(){
    if(!renderer)return;
    const p=study.panel,r=study.rectangle,key=p.id+':'+state.thickness;
    if(key!==geometryKey){
      if(panelMesh){scene.remove(panelMesh);panelMesh.geometry.dispose();scene.remove(edgeMesh);edgeMesh.geometry.dispose();edgeMesh.material.dispose();}
      const g=C.geometry(T,p,state.thickness);panelMesh=new T.Mesh(g,[frontMaterial,sideMaterial]);scene.add(panelMesh);
      edgeMesh=new T.LineSegments(new T.EdgesGeometry(g,28),new T.LineBasicMaterial({color:C.color(state.color,.48),transparent:true,opacity:.45}));scene.add(edgeMesh);geometryKey=key;
    }
    textureCanvas.height=1280;textureCanvas.width=Math.max(128,Math.round(1280*p.width/p.height));
    C.paint(textureCanvas.getContext('2d'),study,textureCanvas.width,textureCanvas.height);texture.needsUpdate=true;
    frontMaterial.roughness=.56-state.sheen*.003;sideMaterial.color.set(state.color);edgeMesh.material.color.set(C.color(state.color,.48));
    const angle=state.lightAngle*Math.PI/180;light.position.set(140*Math.cos(angle),-140*Math.sin(angle),180);
    if(zoneLine){scene.remove(zoneLine);zoneLine.geometry.dispose();zoneLine.material.dispose();zoneLine=null;}
    if(state.showZones){
      const x1=r.x-p.width/2+.08,x2=x1+r.width-.16,y1=p.height/2-r.y,y2=y1-r.height,z=state.thickness+.06;
      const points=[new T.Vector3(x1,y1,z),new T.Vector3(x2,y1,z),new T.Vector3(x2,y2,z),new T.Vector3(x1,y2,z),new T.Vector3(x1,y1,z)];
      zoneLine=new T.Line(new T.BufferGeometry().setFromPoints(points),new T.LineDashedMaterial({color:0xeef9ff,dashSize:1.2,gapSize:.9,transparent:true,opacity:.8}));zoneLine.computeLineDistances();scene.add(zoneLine);
    }
    requestRender();
  }