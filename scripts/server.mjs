// Localhost-only Surface Lab server: static app + async 3MF job API.
// No shell is ever used; the only subprocess is `<python> scripts/generate_3mf.py <fixed subcommand>`.
import http from 'node:http';
import {spawn} from 'node:child_process';
import {createReadStream, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {basename, join, resolve, sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const GENERATOR = join(root, 'scripts', 'generate_3mf.py');
const DEFAULT_TEMPLATE = join(root, 'assets', 'h2d-empty.3mf');

export function defaultConfig(env = process.env) {
  const positive = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    host: '127.0.0.1',
    port: positive(env.PORT, 4173),
    python: env.PYTHON || 'python3',
    template: env.BAMBU_TEMPLATE ? resolve(env.BAMBU_TEMPLATE) : DEFAULT_TEMPLATE,
    templateSource: env.BAMBU_TEMPLATE ? 'BAMBU_TEMPLATE' : 'bundled',
    angleOffset: Number.isFinite(Number(env.BAMBU_ANGLE_OFFSET)) ? Number(env.BAMBU_ANGLE_OFFSET || 0) : 0,
    jobsDir: resolve(env.JOBS_DIR || join(root, '.tmp', 'jobs')),
    distDir: join(root, 'dist'),
    threeDir: join(root, 'node_modules', 'three'),
    maxConcurrent: positive(env.MAX_CONCURRENT_JOBS, 1),
    maxQueued: positive(env.MAX_QUEUED_JOBS, 4),
    timeoutMs: positive(env.GENERATOR_TIMEOUT_MS, 90_000),
    maxJobs: positive(env.MAX_RETAINED_JOBS, 20),
    maxAgeMs: positive(env.JOB_RETENTION_HOURS, 24) * 3600_000,
    maxBodyBytes: 4 * 1024 * 1024,
    maxOutputBytes: 1024 * 1024,
  };
}

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PHASES = ['queued', 'generating', 'validating', 'ready', 'failed'];

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function slug(value, fallback) {
  const s = String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return s || fallback;
}

// Light structural checks so obviously bad requests never reach Python.
// Full geometric validation is done by the generator.
export function precheckRecipe(recipe) {
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  const finite = v => typeof v === 'number' && Number.isFinite(v);
  if (!isObj(recipe)) throw new HttpError(422, 'Request body must be a Surface Lab recipe object.');
  if (recipe.schema !== 'zudo-surface-preview/v2') throw new HttpError(422, 'Unsupported recipe schema; expected zudo-surface-preview/v2.');
  const {panel, artwork} = recipe;
  if (!isObj(panel) || !isObj(artwork)) throw new HttpError(422, 'Recipe needs panel and artwork objects.');
  if (recipe.reference) throw new HttpError(422, 'Imported images are preview-only and cannot become a 3MF yet.');
  if (artwork.kind !== 'regional') throw new HttpError(422, 'Only Directional regions patterns can become a 3MF. Curves and artwork patterns are preview-only.');
  if (artwork.composition?.mode === 'overlay') throw new HttpError(422, 'Overlay compositions are preview-only.');
  for (const key of ['width', 'height']) if (!finite(panel[key]) || panel[key] <= 0 || panel[key] > 300) throw new HttpError(422, `Panel ${key} is invalid.`);
  if (panel.studyThickness !== undefined && (!finite(panel.studyThickness) || panel.studyThickness <= 0 || panel.studyThickness > 8)) throw new HttpError(422, 'Panel thickness is invalid.');
  if (!Array.isArray(artwork.regions) || artwork.regions.length === 0) throw new HttpError(422, 'Pattern has no regions.');
  if (artwork.regions.length > 1500) throw new HttpError(422, 'Pattern has too many regions; increase the pattern scale.');
  for (const [i, r] of artwork.regions.entries()) {
    if (!isObj(r) || !Array.isArray(r.polygon) || r.polygon.length < 3 || r.polygon.length > 512) throw new HttpError(422, `Region ${i} polygon is malformed.`);
    if (!r.polygon.every(p => Array.isArray(p) && p.length === 2 && finite(p[0]) && finite(p[1]))) throw new HttpError(422, `Region ${i} has invalid coordinates.`);
    if (r.angle !== undefined && !finite(r.angle)) throw new HttpError(422, `Region ${i} angle is invalid.`);
  }
  // Keep only what the generator reads plus provenance; drop preview path data.
  return {
    schema: recipe.schema, engineVersion: recipe.engineVersion, units: recipe.units ?? 'mm', coordinateSystem: recipe.coordinateSystem,
    panel, artwork, reference: null, manufacturing: recipe.manufacturing, editorState: recipe.editorState,
  };
}

function runProcess(cmd, args, {cwd, timeoutMs, maxOutputBytes}) {
  return new Promise(resolvePromise => {
    let stdout = '', stderr = '', size = 0, timedOut = false, settled = false;
    let child;
    const finish = result => { if (!settled) { settled = true; clearTimeout(timer); resolvePromise(result); } };
    try {
      child = spawn(cmd, args, {cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: {PATH: process.env.PATH ?? '', PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1', LANG: 'C.UTF-8'}});
    } catch (error) {
      return finish({code: null, error, stdout, stderr});
    }
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    const collect = which => chunk => {
      size += chunk.length;
      if (size > maxOutputBytes) { child.kill('SIGKILL'); return; }
      if (which === 'out') stdout += chunk; else stderr += chunk;
    };
    child.stdout.setEncoding('utf8').on('data', collect('out'));
    child.stderr.setEncoding('utf8').on('data', collect('err'));
    child.on('error', error => finish({code: null, error, stdout, stderr}));
    child.on('close', code => finish({code, timedOut, overflow: size > maxOutputBytes, stdout, stderr}));
  });
}

function generatorError(result, step, python) {
  if (result.error?.code === 'ENOENT') return `Python was not found (tried "${python}"). Install Python 3.10+ or set PYTHON=/path/to/python3.`;
  if (result.error) return `Could not start the ${step} step.`;
  if (result.timedOut) return `The ${step} step timed out. Try a larger pattern scale (fewer regions).`;
  if (result.overflow) return `The ${step} step produced too much output.`;
  try {
    const parsed = JSON.parse(result.stderr.trim().split('\n').pop());
    if (parsed?.error) return String(parsed.error).slice(0, 600);
  } catch { /* fall through */ }
  return `The ${step} step failed (exit ${result.code}).`;
}

export function createApp(overrides = {}) {
  const config = {...defaultConfig(), ...overrides};
  mkdirSync(config.jobsDir, {recursive: true});
  const jobs = new Map();
  const queue = [];
  let running = 0;
  let environment = {checked: false};

  async function checkEnvironment() {
    const py = await runProcess(config.python, ['--version'], {cwd: root, timeoutMs: 10_000, maxOutputBytes: 4096});
    const python = py.code === 0
      ? {available: true, version: (py.stdout || py.stderr).trim().replace(/^Python\s*/, '')}
      : {available: false, message: generatorError(py, 'Python check', config.python)};
    let template = {available: existsSync(config.template), source: config.templateSource, file: basename(config.template)};
    if (!template.available) {
      template.message = config.templateSource === 'bundled'
        ? 'The bundled H2D template assets/h2d-empty.3mf is missing.'
        : 'The template set in BAMBU_TEMPLATE was not found.';
    } else if (python.available) {
      const info = await runProcess(config.python, [GENERATOR, 'template-info', config.template], {cwd: root, timeoutMs: 20_000, maxOutputBytes: config.maxOutputBytes});
      if (info.code === 0) {
        const d = JSON.parse(info.stdout);
        template = {...template, ok: true, printer: d.printer_model, printerProfile: d.printer_profile, processProfile: d.process_profile,
          nozzle: d.nozzle_diameter, filaments: d.filament_profiles, bedType: d.bed_type, layerHeight: d.layer_height_mm,
          initialLayerHeight: d.initial_layer_height_mm, modifierHeight: d.modifier_top_mm};
      } else {
        template = {...template, ok: false, message: generatorError(info, 'template check', config.python)};
      }
    }
    environment = {checked: true, python, template, ready: python.available && template.ok === true};
    return environment;
  }

  function publicJob(job) {
    return {
      id: job.id, phase: job.phase, createdAt: job.createdAt, updatedAt: job.updatedAt,
      filename: job.filename, error: job.error ?? null, warnings: job.report?.warnings ?? [],
      summary: job.report ? {
        panel: job.report.panel, pattern: job.report.pattern, modifierHeight: job.report.modifier_height_mm,
        template: job.report.template, transform: job.report.transform, unsliced: true,
        validationChecks: job.validation?.checks?.length ?? 0,
      } : null,
      downloadUrl: job.phase === 'ready' ? `/api/jobs/${job.id}/download` : null,
      position: job.phase === 'queued' ? queue.indexOf(job) + 1 : 0,
    };
  }

  function setPhase(job, phase, extra = {}) {
    Object.assign(job, extra, {phase, updatedAt: new Date().toISOString()});
    try {
      writeFileSync(join(job.dir, 'job.json'), JSON.stringify({...publicJob(job), report: job.report ?? null, validation: job.validation ?? null}, null, 2));
    } catch { /* job directory may have been pruned */ }
  }

  async function runJob(job) {
    const opts = {cwd: job.dir, timeoutMs: config.timeoutMs, maxOutputBytes: config.maxOutputBytes};
    const files = ['--template', config.template, '--recipe', join(job.dir, 'recipe.json'), '--output', join(job.dir, 'project.3mf'), '--angle-offset', String(config.angleOffset)];
    setPhase(job, 'generating');
    const gen = await runProcess(config.python, [GENERATOR, 'generate', '--no-validate', ...files], opts);
    if (gen.code !== 0) return setPhase(job, 'failed', {error: generatorError(gen, 'generation', config.python)});
    let report;
    try { report = JSON.parse(gen.stdout); } catch { return setPhase(job, 'failed', {error: 'Generator returned an unreadable report.'}); }
    const hp = Number.isFinite(Number(report.panel?.hp)) ? `${Number(report.panel.hp)}hp` : 'custom';
    job.filename = `zudo-blank-${hp}-${slug(report.pattern?.id, 'pattern')}-${job.id.slice(0, 8)}.3mf`;
    setPhase(job, 'validating', {report});
    const val = await runProcess(config.python, [GENERATOR, 'validate', ...files], opts);
    if (val.code !== 0) return setPhase(job, 'failed', {error: generatorError(val, 'validation', config.python)});
    let validation;
    try { validation = JSON.parse(val.stdout); } catch { return setPhase(job, 'failed', {error: 'Validator returned an unreadable report.'}); }
    writeFileSync(join(job.dir, 'report.json'), JSON.stringify({...report, validation}, null, 2));
    setPhase(job, 'ready', {validation});
  }

  function pump() {
    while (running < config.maxConcurrent && queue.length) {
      const job = queue.shift();
      running++;
      runJob(job).catch(error => setPhase(job, 'failed', {error: `Unexpected server error: ${error.message}`}))
        .finally(() => { running--; prune(); pump(); });
    }
  }

  function prune() {
    const now = Date.now();
    let entries = [];
    try {
      entries = readdirSync(config.jobsDir).filter(name => JOB_ID.test(name))
        .map(name => ({name, mtime: statSync(join(config.jobsDir, name)).mtimeMs})).sort((a, b) => b.mtime - a.mtime);
    } catch { return; }
    entries.forEach((entry, index) => {
      const job = jobs.get(entry.name);
      if (job && (job.phase === 'queued' || job.phase === 'generating' || job.phase === 'validating')) return;
      if (index >= config.maxJobs || now - entry.mtime > config.maxAgeMs) {
        rmSync(join(config.jobsDir, entry.name), {recursive: true, force: true});
        jobs.delete(entry.name);
      }
    });
  }

  function submit(recipe) {
    if (!environment.ready) {
      const reason = !environment.python?.available ? environment.python?.message : environment.template?.message;
      throw new HttpError(503, reason || 'The generator is not ready.');
    }
    if (queue.length >= config.maxQueued) throw new HttpError(429, 'Too many 3MF jobs are waiting. Try again in a moment.');
    const clean = precheckRecipe(recipe);
    const id = randomUUID();
    const dir = join(config.jobsDir, id);
    mkdirSync(dir, {recursive: true});
    writeFileSync(join(dir, 'recipe.json'), JSON.stringify(clean, null, 2));
    const now = new Date().toISOString();
    const job = {id, dir, phase: 'queued', createdAt: now, updatedAt: now, filename: null};
    jobs.set(id, job);
    queue.push(job);
    setPhase(job, 'queued');
    pump();
    return job;
  }

  // --- HTTP -----------------------------------------------------------------
  const allowedHosts = () => new Set([`127.0.0.1:${config.port}`, `localhost:${config.port}`, `[::1]:${config.port}`]);

  function send(res, status, body, headers = {}) {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body, null, 2));
    res.writeHead(status, {'content-length': buf.length, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store',
      ...(typeof body === 'object' && !Buffer.isBuffer(body) ? {'content-type': 'application/json; charset=utf-8'} : {}), ...headers});
    res.end(buf);
  }

  function sendFile(res, path, type, extra = {}) {
    let st;
    try { st = statSync(path); } catch { return send(res, 404, {error: 'Not found'}); }
    if (!st.isFile()) return send(res, 404, {error: 'Not found'});
    res.writeHead(200, {'content-type': type, 'content-length': st.size, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store', ...extra});
    createReadStream(path).pipe(res);
  }

  function readBody(req) {
    return new Promise((ok, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', chunk => {
        size += chunk.length;
        if (size > config.maxBodyBytes) { reject(new HttpError(413, 'Recipe is too large.')); req.destroy(); return; }
        chunks.push(chunk);
      });
      req.on('end', () => ok(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  function staticUnder(base, rel) {
    if (!/^[A-Za-z0-9_\-./]+$/.test(rel) || rel.split('/').some(s => s === '..' || s === '' || s.startsWith('.'))) return null;
    const full = resolve(base, rel);
    return full.startsWith(base + sep) ? full : null;
  }

  async function handle(req, res) {
    const host = req.headers.host || '';
    if (!allowedHosts().has(host)) return send(res, 403, {error: 'This local server only answers requests addressed to localhost.'});
    const origin = req.headers.origin;
    if (origin && !allowedHosts().has(origin.replace(/^https?:\/\//, ''))) return send(res, 403, {error: 'Cross-origin requests are not allowed.'});
    const url = new URL(req.url, `http://${host}`);
    const path = url.pathname;

    if (path === '/api/status' && req.method === 'GET') {
      if (!environment.checked) await checkEnvironment();
      return send(res, 200, {ok: environment.ready, generator: 'regional-modifiers', unsliced: true, python: environment.python, template: environment.template,
        limits: {maxConcurrent: config.maxConcurrent, maxQueued: config.maxQueued, timeoutSeconds: config.timeoutMs / 1000, retainedJobs: config.maxJobs}});
    }
    if (path === '/api/jobs' && req.method === 'POST') {
      if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw new HttpError(415, 'Send the recipe as application/json.');
      if (!environment.checked) await checkEnvironment();
      const body = await readBody(req);
      let recipe;
      try { recipe = JSON.parse(body.toString('utf8')); } catch { throw new HttpError(400, 'Request body is not valid JSON.'); }
      const job = submit(recipe);
      return send(res, 202, publicJob(job), {location: `/api/jobs/${job.id}`});
    }
    const m = path.match(/^\/api\/jobs\/([^/]+)(\/download)?$/);
    if (m && req.method === 'GET') {
      if (!JOB_ID.test(m[1])) throw new HttpError(400, 'Invalid job id.');
      const job = jobs.get(m[1]);
      if (!job) throw new HttpError(404, 'Job not found or already cleaned up.');
      if (!m[2]) return send(res, 200, publicJob(job));
      if (job.phase !== 'ready') throw new HttpError(409, 'The 3MF is not ready yet.');
      return sendFile(res, join(job.dir, 'project.3mf'), 'model/3mf', {'content-disposition': `attachment; filename="${job.filename}"`});
    }
    if (path.startsWith('/api/')) throw new HttpError(404, 'Unknown API endpoint.');
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');

    if (path === '/' || path === '/index.html') return sendFile(res, join(config.distDir, 'index.html'), 'text/html; charset=utf-8');
    if (path.startsWith('/src/')) {
      const file = staticUnder(join(config.distDir, 'src'), path.slice(5));
      return file && file.endsWith('.js') ? sendFile(res, file, 'text/javascript; charset=utf-8') : send(res, 404, {error: 'Not found'});
    }
    if (path === '/vendor/three/three.module.js' || path === '/vendor/three/three.core.js') {
      const file = join(config.threeDir, 'build', basename(path));
      if (!existsSync(file)) return send(res, 503, {error: 'Three.js is missing. Run npm install.'});
      return sendFile(res, file, 'text/javascript; charset=utf-8');
    }
    if (path.startsWith('/vendor/three/addons/')) {
      const file = staticUnder(join(config.threeDir, 'examples', 'jsm'), path.slice('/vendor/three/addons/'.length));
      return file && file.endsWith('.js') ? sendFile(res, file, 'text/javascript; charset=utf-8') : send(res, 404, {error: 'Not found'});
    }
    if (path === '/favicon.ico') return send(res, 204, '');
    return send(res, 404, {error: 'Not found'});
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(error => {
      if (res.headersSent) { res.destroy(); return; }
      const status = error instanceof HttpError ? error.status : 500;
      send(res, status, {error: status === 500 ? 'Internal server error.' : error.message});
      if (status === 500) console.error(error);
    });
  });

  prune();
  return {
    server, config, jobs, checkEnvironment,
    listen() {
      return new Promise((ok, reject) => {
        server.once('error', reject);
        server.listen(config.port, config.host, () => {
          config.port = server.address().port;
          checkEnvironment().catch(() => {});
          ok(server);
        });
      });
    },
    close() { return new Promise(ok => server.close(() => ok())); },
  };
}

export {PHASES};
