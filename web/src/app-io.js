  async function loadImage(dataUrl,fileName,source={}){
    const serial=++importSerial;$('importError').hidden=true;
    try{
      const image=new Image();image.src=dataUrl;await image.decode();
      if(serial!==importSerial)return;
      if(!image.naturalWidth||!image.naturalHeight)throw new Error('Image has no usable dimensions.');
      state.image={dataUrl,name:fileName,width:image.naturalWidth,height:image.naturalHeight,element:image,id:source.id||null,sourceUrl:source.sourceUrl||null,credit:source.credit||null};
      state.imageFit='cover';state.imageZoom=1;state.imageOffsetX=0;state.imageOffsetY=0;
      for(const[id,value]of Object.entries({imageFit:'cover',imageZoom:1,imageOffsetX:0,imageOffsetY:0}))$(id).value=value;
      syncControls();refresh();remember();toast('Artwork placed in the rectangle');
    }catch(error){$('importError').textContent='Could not read that image. Please try a PNG or a self-contained SVG.';$('importError').hidden=false;}
  }
  async function importFile(file){
    if(!file)return;
    $('importError').hidden=true;
    try{
      if(file.size>12*1024*1024)throw new Error('Please use an image smaller than 12 MB.');
      if(!/\.(png|jpe?g|webp|svg)$/i.test(file.name))throw new Error('Choose a PNG, JPEG, WebP, or SVG image.');
      let dataUrl;
      if(/\.svg$/i.test(file.name)){
        const xml=await file.text(),doc=new DOMParser().parseFromString(xml,'image/svg+xml');
        if(doc.querySelector('parsererror')||doc.documentElement.localName!=='svg')throw new Error('This SVG could not be parsed.');
        if(doc.querySelector('script,foreignObject,iframe,object,embed'))throw new Error('Use a plain SVG without embedded scripts or HTML.');
        for(const el of doc.querySelectorAll('*'))for(const attr of Array.from(el.attributes)){
          if(/^on/i.test(attr.name))throw new Error('Use a plain SVG without event handlers.');
          if(/(?:href|src)$/i.test(attr.localName)&&attr.value&&!attr.value.startsWith('#')&&!attr.value.startsWith('data:image/'))throw new Error('This SVG links to another file. Export a self-contained SVG or PNG.');
        }
        if(/@import/i.test(xml))throw new Error('This SVG loads an external resource. Export a self-contained SVG or PNG.');
        for(const match of xml.matchAll(/url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/gi))if(!match[1].startsWith('#')&&!match[1].startsWith('data:image/'))throw new Error('This SVG loads an external resource. Export a self-contained SVG or PNG.');
        dataUrl='data:image/svg+xml;base64,'+btoa(Array.from(new TextEncoder().encode(xml),b=>String.fromCharCode(b)).join(''));
      }else dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});
      await loadImage(dataUrl,file.name);
    }catch(error){$('importError').textContent=error.message||'Could not import this image.';$('importError').hidden=false;}
    $('imageFile').value='';
  }
  function download(blob,filename){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  function stem(){return 'zudo-'+panel().hp+'hp-'+(state.image?'artwork':state.patternId);}
  function saveRecipe(){download(new Blob([JSON.stringify(C.recipe(study),null,2)+'\n'],{type:'application/json'}),stem()+'.recipe.json');toast('Preview recipe saved');}
  function saveSvg(){download(new Blob([C.svg(study)],{type:'image/svg+xml'}),stem()+'.svg');toast('Flat appearance SVG saved');}
  async function savePng(){
    const button=$('exportPng');button.disabled=true;
    try{
      const output=document.createElement('canvas');output.width=1600;output.height=1400;const ctx=output.getContext('2d');
      const gradient=ctx.createRadialGradient(800,600,20,800,650,950);gradient.addColorStop(0,'#f8fafb');gradient.addColorStop(1,'#e0e7ec');ctx.fillStyle=gradient;ctx.fillRect(0,0,1600,1400);
      if(state.view==='angle'&&renderer){
        renderer.render(scene,camera);const source=renderer.domElement,scale=Math.min(1540/source.width,1190/source.height),w=source.width*scale,h=source.height*scale;ctx.drawImage(source,(1600-w)/2,95+(1190-h)/2,w,h);
      }else{
        const data='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(C.svg(study));const img=new Image();img.src=data;await img.decode();
        const scale=Math.min(1230/study.panel.width,1070/study.panel.height),w=study.panel.width*scale,h=study.panel.height*scale;ctx.drawImage(img,(1600-w)/2,160,w,h);
      }
      ctx.fillStyle='#293b48';ctx.font='500 34px sans-serif';ctx.fillText('ZUDO SURFACE LAB',64,65);ctx.font='28px sans-serif';ctx.fillText(panel().label+' · '+name(),64,113);
      ctx.fillStyle='#526674';ctx.font='23px sans-serif';ctx.fillText($('panelDimensions').textContent+'   /   '+$('artDimensions').textContent,64,1310);ctx.font='20px sans-serif';ctx.fillText('Appearance preview · not sliced toolpaths · illustrative lighting',64,1350);
      const blob=await new Promise(resolve=>output.toBlob(resolve,'image/png'));if(!blob)throw new Error('PNG conversion failed');download(blob,stem()+'.png');toast('Panel PNG saved');
    }catch(error){toast('PNG export failed. Try the flat SVG export.');}finally{button.disabled=false;}
  }

  // --- Make 3MF: Choose design → Make 3MF → Generating → Validating → Download available
  let mfStatus=null,mfJob=null,mfPoll=0;
  function mfEligibility(){
    if(state.image)return 'Imported images are preview-only. Clear the image to make a 3MF.';
    if(state.compositionMode==='overlay')return 'Overlay compositions are preview-only.';
    if(study?.pattern?.kind!=='regional'||!study.pattern.regions?.length)return 'Only Directional regions patterns can become a 3MF; curves and artwork stay preview-only.';
    return '';
  }
  function update3mfCapability(){
    const button=$('make3mf'); if(!button)return;
    const reason=mfEligibility(),busy=mfJob&&!['ready','failed'].includes(mfJob.phase);
    button.disabled=!!reason; button.title=reason||'Generate an unsliced H2D Bambu Studio project';
    button.textContent=reason?'3MF preview only':busy?'Generating…':'Make 3MF';
    const status=$('threeMfStatus');
    if(status&&!busy)status.textContent=reason||`${study.pattern.regions.length} modifier regions · H2D template · unsliced`;
    if($('make3mfDialog')?.open&&!busy)renderMfSummary();
  }
  function mfText(id,text){$(id).textContent=text;}
  function renderMfSummary(){
    const p=study.panel,r=study.rectangle,t=mfStatus?.template;
    mfText('mfPanel',`${p.label||p.hp+' HP'} · ${p.width.toFixed(2)} × ${p.height.toFixed(2)} × ${state.thickness} mm · artwork ${r.width.toFixed(1)} × ${r.height.toFixed(1)} mm`);
    mfText('mfPattern',name()+(state.compositionMode!=='single'?` (${state.compositionMode})`:''));
    mfText('mfRegions',String(study.pattern.regions?.length||0));
    if(!mfStatus){mfText('mfTemplate','Checking local generator…');mfText('mfProfile','—');mfText('mfHeight','—');return;}
    mfText('mfTemplate',t?.ok?`${t.printer} · ${t.source==='bundled'?'bundled H2D template':'BAMBU_TEMPLATE override'} (${t.file})`:(t?.message||'Template unavailable'));
    mfText('mfProfile',t?.ok?`${t.processProfile} · nozzle ${[].concat(t.nozzle).join(' / ')} mm · ${[].concat(t.filaments)[0]||'filament from template'}`:'—');
    mfText('mfHeight',t?.ok?`${Number(t.modifierHeight).toFixed(2)} mm (first layer ${t.initialLayerHeight} mm + ¼ of ${t.layerHeight} mm)`:'—');
    const reason=mfEligibility()||(!mfStatus.python?.available?mfStatus.python?.message:'')||(!t?.ok?t?.message:'');
    $('mfGenerate').disabled=!!reason||(mfJob&&!['ready','failed'].includes(mfJob.phase));
    if(reason&&(!mfJob||mfJob.phase==='ready'||mfJob.phase==='failed'))mfMessage(reason,'error');
  }
  function mfMessage(text,tone){const el=$('mfMessage');el.textContent=text;if(tone)el.dataset.tone=tone;else delete el.dataset.tone;}
  function mfSteps(phase){
    const order=['generating','validating','ready'],at=order.indexOf(phase);
    for(const li of $('mfSteps').children){const i=order.indexOf(li.dataset.step);
      li.dataset.state=phase==='failed'?(li.dataset.state==='active'?'failed':li.dataset.state||''):phase==='ready'?'done':i<at?'done':i===at?'active':'';}
  }
  function mfWarnings(list){const ul=$('mfWarnings');ul.replaceChildren(...list.map(w=>{const li=document.createElement('li');li.textContent=w;return li;}));ul.hidden=!list.length;}
  async function loadMfStatus(force){
    if(mfStatus&&!force)return mfStatus;
    try{const response=await fetch('/api/status');mfStatus=await response.json();}
    catch(error){mfStatus={python:{available:false,message:'The local server is not reachable. Start it with npm run dev.'},template:{ok:false,message:'Local server not reachable.'}};}
    return mfStatus;
  }
  async function make3mf(){
    if($('make3mf').disabled)return;
    const dialog=$('make3mfDialog');
    if(!mfJob||['ready','failed'].includes(mfJob.phase)){mfJob=null;mfSteps('');mfWarnings([]);mfMessage('Review the project, then generate.');$('mfDownload').hidden=true;$('mfGenerate').textContent='Generate';$('mfGenerate').classList.add('primary');}
    if(!dialog.open)dialog.showModal();
    renderMfSummary();await loadMfStatus(true);renderMfSummary();
  }
  async function startMfJob(){
    if($('mfGenerate').disabled)return;
    const serial=++mfPoll;$('mfDownload').hidden=true;mfWarnings([]);mfSteps('generating');mfMessage('Sending recipe to the local generator…');$('mfGenerate').disabled=true;
    try{
      const response=await fetch('/api/jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(C.recipe(study))});
      const payload=await response.json().catch(()=>({error:'The local server returned an unreadable response.'}));
      if(!response.ok)throw new Error(payload.error||'3MF generation failed');
      mfJob=payload;update3mfCapability();
      while(serial===mfPoll){
        mfSteps(mfJob.phase==='queued'?'generating':mfJob.phase);
        mfMessage({queued:`Queued (position ${mfJob.position||1})…`,generating:'Building panel body, mounting openings and first-layer modifiers…',validating:'Re-opening the archive and checking geometry, metadata and template settings…'}[mfJob.phase]||'');
        if(mfJob.phase==='ready'||mfJob.phase==='failed')break;
        await new Promise(r=>setTimeout(r,350));
        const next=await fetch('/api/jobs/'+mfJob.id);const body=await next.json();if(!next.ok)throw new Error(body.error||'Lost track of the generation job');mfJob=body;
      }
      if(serial!==mfPoll)return;
      if(mfJob.phase==='failed')throw new Error(mfJob.error||'Generation failed');
      const s=mfJob.summary;mfSteps('ready');mfWarnings(mfJob.warnings||[]);
      mfMessage(`Ready · ${mfJob.filename} · ${s.pattern.regions} modifier regions · ${Number(s.modifierHeight).toFixed(2)} mm modifier height · ${s.validationChecks} validation checks passed · unsliced`);
      const a=$('mfDownload');a.href=mfJob.downloadUrl;a.download=mfJob.filename;a.textContent='Download 3MF';a.title=mfJob.filename;$('mfGenerate').textContent='Generate again';$('mfGenerate').classList.remove('primary');a.hidden=false;a.focus();
      $('threeMfStatus').textContent='3MF ready · '+mfJob.filename;
      toast('3MF ready. Open it in Bambu Studio and inspect the first two layers.');
    }catch(error){
      if(serial!==mfPoll)return;
      console.error(error);mfSteps('failed');mfMessage('Generation failed · '+error.message,'error');
      if(mfJob)mfJob.phase='failed';else mfJob={phase:'failed'};
    }finally{if(serial===mfPoll){update3mfCapability();renderMfSummary();}}
  }