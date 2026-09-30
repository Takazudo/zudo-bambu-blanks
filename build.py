"""Build the local Surface Lab shell. Three.js stays a local npm dependency."""
from pathlib import Path
p=Path(__file__).resolve().parent
src=p/'web'/'src'
app='\n'.join((src/f).read_text() for f in ['app-head.js','app-main.js','app-io.js','app-bindings.js'])
(src/'app.js').write_text(app)
css='\n'.join((src/f).read_text() for f in ['base.css','v2.css'])
shell=(src/'shell-v2.html').read_text()
loader='''<script type="module">\nimport * as THREE_NS from '/vendor/three.module.js';\nimport { OrbitControls } from '/vendor/OrbitControls.js';\nwindow.THREE={...THREE_NS,OrbitControls};\nfor (const path of ['/src/catalog-lite.js','/src/core.js','/src/patterns-v2.js','/src/app.js']) {\n  const response=await fetch(path);\n  if(!response.ok) throw new Error(`Failed to load ${path}`);\n  (0,eval)(await response.text());\n}\n</script>'''
html=shell.replace('<!--STYLES-->','<style>\n'+css+'\n</style>').replace('<!--SCRIPTS-->',loader)
out=p/'dist'/'index.html';out.parent.mkdir(exist_ok=True);out.write_text(html)
print(out,out.stat().st_size)
