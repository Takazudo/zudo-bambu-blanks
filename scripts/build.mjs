// Build Surface Lab into dist/ (generated, git-ignored). No Python needed for the UI.
//   dist/index.html  shell + inlined CSS + module loader
//   dist/src/*.js    runtime scripts, evaluated in order by the loader
// Three.js is served from node_modules by scripts/dev.mjs through an import map,
// so the add-ons resolve `three` to the same module instance.
import {copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const src = join(root, 'web', 'src');
const dist = join(root, 'dist');
const appParts = ['app-head.js', 'app-main.js', 'app-io.js', 'app-bindings.js'];
const runtime = ['catalog-lite.js', 'core.js', 'patterns-v2.js', 'app.js'];
const styles = ['base.css', 'v2.css', 'make-3mf.css'];

const loader = `<script type="importmap">{"imports":{"three":"/vendor/three/three.module.js","three/addons/":"/vendor/three/addons/"}}</script>
<script type="module">
try {
  const [THREE_NS, {OrbitControls}, {RoomEnvironment}] = await Promise.all([
    import('three'), import('three/addons/controls/OrbitControls.js'), import('three/addons/environments/RoomEnvironment.js')]);
  window.THREE = {...THREE_NS, OrbitControls, RoomEnvironment};
  window.OrbitControls = OrbitControls;
  window.RoomEnvironment = RoomEnvironment;
} catch (error) {
  // Without Three.js the app still runs in flat view; initialize3D() reports the fallback.
  console.warn('Three.js failed to load; run npm install. Flat view only.', error);
  window.THREE = {};
}
for (const path of ${JSON.stringify(runtime.map(name => '/src/' + name))}) {
  const response = await fetch(path);
  if (!response.ok) throw new Error('Failed to load ' + path);
  (0, eval)(await response.text() + '\\n//# sourceURL=' + path);
}
</script>`;

export function build() {
  rmSync(dist, {recursive: true, force: true});
  mkdirSync(join(dist, 'src'), {recursive: true});
  const read = name => readFileSync(join(src, name), 'utf8');
  writeFileSync(join(dist, 'src', 'app.js'), appParts.map(read).join('\n'));
  for (const name of runtime.slice(0, -1)) copyFileSync(join(src, name), join(dist, 'src', name));
  const css = styles.map(read).join('\n');
  const shell = read('shell-v2.html');
  if (!shell.includes('<!--STYLES-->') || !shell.includes('<!--SCRIPTS-->')) throw new Error('shell-v2.html is missing its placeholders');
  const html = shell.replace('<!--STYLES-->', () => '<style>\n' + css + '\n</style>').replace('<!--SCRIPTS-->', () => loader);
  const out = join(dist, 'index.html');
  writeFileSync(out, html);
  return {out, bytes: statSync(out).size};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {bytes} = build();
  console.log(`dist/index.html ${bytes} bytes`);
}
