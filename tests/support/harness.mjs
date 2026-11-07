// Shared test harness: builds the app, starts the real server on an ephemeral
// port with an isolated jobs directory, and opens the real Surface Lab in Chromium.
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from '../../scripts/build.mjs';
import {createApp} from '../../scripts/server.mjs';

export const FIXTURES = [
  {name: '04hp-triangular-facets', panelId: 'cad-3u-4hp', state: {patternId: 'triangular-facets', scale: 2}},
  {name: '12hp-basket-weave', panelId: 'cad-3u-12hp', state: {patternId: 'basket-weave'}},
  {name: '20hp-pinwheel', panelId: 'cad-3u-20hp', state: {patternId: 'pinwheel'}},
  {name: '20hp-split-regional', panelId: 'cad-3u-20hp', state: {patternId: 'basket-weave', compositionMode: 'split-y', secondaryPattern: 'diagonal-bands', splitRatio: 0.5, secondaryRotation: 90}},
];

export async function startServer(overrides = {}) {
  build();
  const jobsDir = mkdtempSync(join(tmpdir(), 'zudo-jobs-'));
  const app = createApp({port: 0, jobsDir, ...overrides});
  await app.listen();
  const base = `http://127.0.0.1:${app.config.port}`;
  return {app, base, async stop() { await app.close(); rmSync(jobsDir, {recursive: true, force: true}); }};
}

export async function launchBrowser(options = {}) {
  let chromium;
  try { ({chromium} = await import('playwright')); } catch { return null; }
  return chromium.launch({args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], ...options});
}

export async function openLab(browser, base, contextOptions = {}) {
  const context = await browser.newContext({acceptDownloads: true, ...contextOptions});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base);
  await page.waitForFunction(() => window.ZudoSurfaceLab && window.ZudoSurfaceLab.getStudy());
  return {context, page, errors};
}

/** Produce a recipe exactly as the browser's "Save recipe" / "Make 3MF" does. */
export async function recipeFromApp(page, fixture) {
  return page.evaluate(({panelId, state}) => {
    const lab = window.ZudoSurfaceLab;
    Object.assign(lab.state, lab.defaults, {image: null});
    lab.choosePattern(state.patternId);
    Object.assign(lab.state, state, {panelId});
    lab.syncControls();
    lab.refresh();
    return window.ZudoSurfaceCore.recipe(lab.getStudy());
  }, fixture);
}
