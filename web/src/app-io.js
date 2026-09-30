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

  function update3mfCapability(){
    const button=$('make3mf'); if(!button)return;
    const regional=study?.pattern?.kind==='regional'&&study.pattern.regions?.length>0&&state.compositionMode!=='overlay'&&!state.image;
    button.disabled=!regional; button.title=regional?'Generate an unsliced H2D Bambu Studio project':'3MF generation currently supports regional patterns without image/overlay composition';
    if(!button.dataset.busy) button.textContent=regional?'Make 3MF':'3MF preview only';
    const status=$('threeMfStatus'); if(status&&!status.dataset.job) status.textContent=regional?`${study.pattern.regions.length} modifier regions · H2D template · unsliced`:'This design needs a manufacturing adapter before 3MF generation';
  }
  async function make3mf(){
    const button=$('make3mf'),status=$('threeMfStatus');
    if(button.disabled)return; button.dataset.busy='1'; button.disabled=true; button.textContent='Generating…'; status.dataset.job='1'; status.textContent='Generating multipart project and validating archive…';
    try{
      const response=await fetch('/api/3mf',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(C.recipe(study))});
      const payload=await response.json(); if(!response.ok)throw Error(payload.error||'3MF generation failed');
      status.textContent=`Ready · ${payload.report.pattern.regions} modifier regions · ${payload.report.modifier_height_mm.toFixed(2)} mm modifier height`;
      const a=document.createElement('a');a.href=payload.downloadUrl;a.download=payload.filename;document.body.append(a);a.click();a.remove();
      toast('3MF generated. Open it in Bambu Studio and inspect the first two layers.');
    }catch(error){console.error(error);status.textContent='Generation failed · '+error.message;toast('3MF generation failed: '+error.message);}
    finally{delete button.dataset.busy;delete status.dataset.job;update3mfCapability();}
  }