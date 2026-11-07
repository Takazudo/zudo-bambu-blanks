// Full local API: browser-made recipe → POST /api/jobs → Python generate → validate → download.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import http from 'node:http';
import {startServer} from './support/harness.mjs';
import {root, precheckRecipe} from '../scripts/server.mjs';

const fixture = name => JSON.parse(readFileSync(join(root, 'examples', 'fixtures', `${name}.recipe.json`), 'utf8'));
let server;
before(async () => { server = await startServer(); });
after(async () => { await server?.stop(); });

const api = (path, init = {}) => fetch(server.base + path, init);
const post = (body, headers = {'content-type': 'application/json'}) => api('/api/jobs', {method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body)});

async function waitFor(id, timeoutMs = 30_000) {
  const end = Date.now() + timeoutMs;
  const seen = new Set();
  for (;;) {
    const job = await (await api(`/api/jobs/${id}`)).json();
    seen.add(job.phase);
    if (job.phase === 'ready' || job.phase === 'failed') return {job, seen};
    if (Date.now() > end) throw new Error('job timed out');
    await new Promise(r => setTimeout(r, 50));
  }
}

function unzipList(buf) {
  const dir = mkdtempSync(join(tmpdir(), 'zudo-dl-'));
  const file = join(dir, 'dl.3mf');
  writeFileSync(file, buf);
  try {
    return JSON.parse(execFileSync('python3', [join(root, 'scripts', 'generate_3mf.py'), 'inspect', file], {encoding: 'utf8'}));
  } finally { rmSync(dir, {recursive: true, force: true}); }
}

test('status reports template and python without local paths', async () => {
  const res = await api('/api/status');
  assert.equal(res.status, 200);
  const status = await res.json();
  assert.equal(status.ok, true);
  assert.equal(status.template.printer, 'Bambu Lab H2D');
  assert.equal(status.template.source, 'bundled');
  assert.equal(status.template.modifierHeight, 0.36);
  assert.ok(!JSON.stringify(status).includes(root), 'no absolute paths leak');
});

for (const name of ['04hp-triangular-facets', '12hp-basket-weave', '20hp-pinwheel', '20hp-split-regional']) {
  test(`fixture ${name}: generate → validate → download`, async () => {
    const recipe = fixture(name);
    const res = await post(recipe);
    assert.equal(res.status, 202);
    const created = await res.json();
    assert.match(created.id, /^[0-9a-f-]{36}$/);
    const {job} = await waitFor(created.id);
    assert.equal(job.phase, 'ready', job.error);
    assert.equal(job.summary.pattern.regions, recipe.artwork.regions.length);
    assert.equal(job.summary.unsliced, true);
    assert.ok(job.summary.validationChecks >= 30);
    assert.match(job.filename, new RegExp(`^zudo-blank-${recipe.panel.hp}hp-${recipe.artwork.patternId}-[0-9a-f]{8}\\.3mf$`));
    const dl = await api(job.downloadUrl);
    assert.equal(dl.status, 200);
    assert.equal(dl.headers.get('content-type'), 'model/3mf');
    assert.equal(dl.headers.get('content-disposition'), `attachment; filename="${job.filename}"`);
    const buf = Buffer.from(await dl.arrayBuffer());
    assert.equal(buf.subarray(0, 2).toString(), 'PK');
    const info = unzipList(buf);
    assert.equal(info.contains_toolpaths, false);
    assert.equal(info.build_items, 1);
    assert.equal(info.parts.filter(p => p.subtype === 'normal_part').length, 1);
    const mods = info.parts.filter(p => p.subtype === 'modifier_part');
    assert.equal(mods.length, recipe.artwork.regions.length);
    assert.ok(mods.every(p => p.settings.bottom_surface_pattern === 'alignedrectilinear'));
    // Debug metadata is retained beside the job.
    const dir = join(server.app.config.jobsDir, job.id);
    assert.deepEqual(readdirSync(dir).sort(), ['job.json', 'project.3mf', 'recipe.json', 'report.json']);
  });
}

test('rejects unsupported and malformed recipes before running python', async () => {
  const cases = [
    [{...fixture('12hp-basket-weave'), artwork: {...fixture('12hp-basket-weave').artwork, kind: 'custom'}}, 422, /Directional regions/],
    [{...fixture('12hp-basket-weave'), artwork: {...fixture('12hp-basket-weave').artwork, composition: {mode: 'overlay'}}}, 422, /Overlay/],
    [{...fixture('12hp-basket-weave'), reference: {name: 'img.png'}}, 422, /Imported images/],
    [{...fixture('12hp-basket-weave'), schema: 'other'}, 422, /schema/],
    [{...fixture('12hp-basket-weave'), panel: {...fixture('12hp-basket-weave').panel, width: -1}}, 422, /width/],
    [[1, 2, 3], 422, /recipe object/],
  ];
  for (const [body, status, message] of cases) {
    const res = await post(body);
    assert.equal(res.status, status);
    assert.match((await res.json()).error, message);
  }
  const bad = fixture('12hp-basket-weave');
  bad.artwork.regions[0].polygon[0] = ['x', 1];
  assert.equal((await post(bad)).status, 422);
  assert.equal((await post('{not json')).status, 400);
  assert.equal((await post(fixture('12hp-basket-weave'), {'content-type': 'text/plain'})).status, 415);
  const huge = JSON.stringify({schema: 'zudo-surface-preview/v2', pad: 'x'.repeat(5 * 1024 * 1024)});
  const res = await post(huge);
  assert.equal(res.status, 413);
  assert.match((await res.json()).error, /too large/);
});

test('geometry errors from python become failed jobs with useful messages', async () => {
  const recipe = fixture('12hp-basket-weave');
  recipe.artwork.regions.push(structuredClone(recipe.artwork.regions[0]));
  const created = await (await post(recipe)).json();
  const {job, seen} = await waitFor(created.id);
  assert.equal(job.phase, 'failed');
  assert.match(job.error, /overlap/);
  assert.ok(seen.has('failed'));
  assert.equal(job.downloadUrl, null);
  assert.equal((await api(`/api/jobs/${created.id}/download`)).status, 409);
});

test('unsafe requests are refused', async () => {
  assert.equal((await api('/api/jobs/..%2F..%2Fetc%2Fpasswd')).status, 400);
  assert.equal((await api('/api/jobs/not-a-uuid/download')).status, 400);
  assert.equal((await api('/api/jobs/11111111-1111-4111-8111-111111111111')).status, 404);
  for (const path of ['/src/../package.json', '/src/%2e%2e/package.json', '/vendor/three/addons/../../package.json', '/vendor/three/addons/.hidden.js', '/etc/passwd']) {
    const res = await api(path);
    assert.ok([400, 404].includes(res.status), `${path} → ${res.status}`);
  }
  assert.equal((await api('/api/status', {headers: {origin: 'http://evil.example'}})).status, 403);
  const rebind = await new Promise(resolve => {
    http.get({host: '127.0.0.1', port: server.app.config.port, path: '/api/status', headers: {host: 'evil.example'}}, res => resolve(res.statusCode));
  });
  assert.equal(rebind, 403);
  assert.equal((await api('/api/jobs', {method: 'DELETE'})).status, 404);
});

test('precheck strips preview path data', () => {
  const recipe = {...fixture('12hp-basket-weave'), pathData: {paths: [{points: [[0, 0]]}]}};
  assert.equal(precheckRecipe(recipe).pathData, undefined);
});

test('missing template, missing python, timeout and queue limits', async () => {
  const cases = [
    [{template: join(root, 'nope.3mf'), templateSource: 'BAMBU_TEMPLATE'}, 503, /BAMBU_TEMPLATE was not found/],
    [{python: 'definitely-not-python-xyz'}, 503, /Python was not found/],
  ];
  for (const [overrides, status, message] of cases) {
    const s = await startServer(overrides);
    try {
      const st = await (await fetch(s.base + '/api/status')).json();
      assert.equal(st.ok, false);
      const res = await fetch(s.base + '/api/jobs', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(fixture('12hp-basket-weave'))});
      assert.equal(res.status, status);
      assert.match((await res.json()).error, message);
    } finally { await s.stop(); }
  }
  // A stand-in interpreter that is slow only for generation, so queue/timeout behaviour is deterministic.
  const stubDir = mkdtempSync(join(tmpdir(), 'zudo-py-'));
  const stub = join(stubDir, 'slow-python');
  writeFileSync(stub, '#!/bin/sh\ncase "$*" in *" generate "*) sleep 3;; esac\nexec python3 "$@"\n', {mode: 0o755});
  const slow = await startServer({python: stub, timeoutMs: 400, maxQueued: 1, maxConcurrent: 1});
  try {
    const body = JSON.stringify(fixture('04hp-triangular-facets'));
    const send = () => fetch(slow.base + '/api/jobs', {method: 'POST', headers: {'content-type': 'application/json'}, body});
    const first = await send();
    const second = await send();
    const third = await send();
    assert.deepEqual([first.status, second.status, third.status], [202, 202, 429]);
    assert.match((await third.json()).error, /Too many/);
    const queued = await second.json();
    assert.equal(queued.phase, 'queued');
    const {id} = await first.json();
    const end = Date.now() + 10_000;
    let job;
    do { job = await (await fetch(`${slow.base}/api/jobs/${id}`)).json(); await new Promise(r => setTimeout(r, 50)); } while (!['ready', 'failed'].includes(job.phase) && Date.now() < end);
    assert.equal(job.phase, 'failed');
    assert.match(job.error, /timed out/);
  } finally { await slow.stop(); rmSync(stubDir, {recursive: true, force: true}); }
});

test('retention keeps at most maxJobs job directories', async () => {
  const s = await startServer({maxJobs: 2});
  try {
    const ids = [];
    for (let i = 0; i < 4; i++) {
      const res = await fetch(s.base + '/api/jobs', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(fixture('04hp-triangular-facets'))});
      const job = await res.json();
      ids.push(job.id);
      let j;
      do { j = await (await fetch(`${s.base}/api/jobs/${job.id}`)).json(); await new Promise(r => setTimeout(r, 30)); } while (!['ready', 'failed'].includes(j.phase));
      await new Promise(r => setTimeout(r, 20));
    }
    const dirs = readdirSync(s.app.config.jobsDir);
    assert.ok(dirs.length <= 2, `retained ${dirs.length}`);
    assert.ok(existsSync(join(s.app.config.jobsDir, ids[3])));
    assert.equal((await fetch(`${s.base}/api/jobs/${ids[0]}`)).status, 404);
  } finally { await s.stop(); }
});
