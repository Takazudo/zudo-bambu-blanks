// Browser automation against the real app (Chromium via Playwright).
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {FIXTURES, launchBrowser, openLab, recipeFromApp, startServer} from './support/harness.mjs';
import {root} from '../scripts/server.mjs';

let server, browser;
before(async () => {
  server = await startServer();
  browser = await launchBrowser();
});
after(async () => { await browser?.close(); await server?.stop(); });


test('desktop boot: 3D with orbit controls, no JS errors', async t => {
  if (!browser) return t.skip('Playwright/Chromium not installed');
  const {page, errors, context} = await openLab(browser, server.base, {viewport: {width: 1280, height: 800}});
  try {
    const state = await page.evaluate(() => ({
      canvas: !!document.querySelector('#modelView canvas'), notice: !document.getElementById('webglNotice').hidden,
      view: window.ZudoSurfaceLab.state.view, patterns: window.ZudoPatterns.metadata.length,
    }));
    assert.equal(state.patterns, 78);
    assert.equal(state.canvas, true, '3D canvas is created');
    assert.equal(state.notice, false, 'WebGL fallback notice stays hidden');
    assert.equal(state.view, 'angle');
    const canvas = page.locator('#modelView canvas');
    const box = await canvas.boundingBox();
    const before = await canvas.screenshot();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2 + 40, {steps: 8});
    await page.mouse.up();
    await page.waitForTimeout(150);
    const afterShot = await canvas.screenshot();
    assert.notDeepEqual(before, afterShot, 'orbit drag changes the rendered view');
    await page.click('#viewFlat');
    assert.equal(await page.locator('#flatView svg').count(), 1);
    await page.click('#viewAngle');
    assert.equal(await page.locator('#modelView').isVisible(), true);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('flat view works on its own when WebGL is unavailable', async t => {
  if (!browser) return t.skip('Playwright/Chromium not installed');
  const context = await browser.newContext();
  await context.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) { return /webgl/i.test(type) ? null : original.call(this, type, ...rest); };
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(server.base);
    await page.waitForFunction(() => window.ZudoSurfaceLab?.getStudy());
    assert.equal(await page.locator('#webglNotice').isVisible(), true);
    assert.equal(await page.locator('#flatView svg').count(), 1);
    assert.equal(await page.locator('#viewAngle').isDisabled(), true);
    assert.equal(await page.locator('#make3mf').isEnabled(), true);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('pattern selection, controls and every pattern render', async t => {
  if (!browser) return t.skip('Playwright/Chromium not installed');
  const {page, errors, context} = await openLab(browser, server.base);
  try {
    const before = await page.textContent('#stageTitle');
    await page.click('#nextPattern');
    assert.notEqual(await page.textContent('#stageTitle'), before);
    await page.locator('#patternRotation').fill('30');
    await page.locator('#patternRotation').dispatchEvent('input');
    await page.waitForTimeout(50);
    assert.equal(await page.evaluate(() => window.ZudoSurfaceLab.state.rotation), 30);
    const results = await page.evaluate(() => {
      const lab = window.ZudoSurfaceLab, bad = [];
      for (const m of window.ZudoPatterns.metadata) {
        lab.choosePattern(m.id);
        const s = lab.getStudy();
        const r = s.rectangle;
        if (!s.pattern || (s.pattern.paths.length === 0 && s.pattern.regions.length === 0)) bad.push(m.id);
        if (Math.abs(r.y - lab.state.endZone) > 1e-9 || Math.abs(r.height - (s.panel.height - 2 * lab.state.endZone)) > 1e-9) bad.push(m.id + ':rect');
      }
      return {count: window.ZudoPatterns.metadata.length, bad};
    });
    assert.equal(results.count, 78);
    assert.deepEqual(results.bad, []);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('recipe export → import round-trips', async t => {
  if (!browser) return t.skip('Playwright/Chromium not installed');
  const {page, errors, context} = await openLab(browser, server.base);
  try {
    await page.evaluate(() => { const lab = window.ZudoSurfaceLab; lab.choosePattern('chevron'); Object.assign(lab.state, {panelId: 'cad-3u-12hp', rotation: 15, seed: 99, thickness: 2.4}); lab.syncControls(); lab.refresh(); });
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#exportRecipe')]);
    const path = await download.path();
    const saved = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(saved.schema, 'zudo-surface-preview/v2');
    await page.evaluate(() => { window.ZudoSurfaceLab.choosePattern('pinwheel'); window.ZudoSurfaceLab.choosePanel('cad-3u-4hp'); });
    await page.setInputFiles('#recipeFile', path);
    await page.waitForFunction(() => window.ZudoSurfaceLab.state.patternId === 'chevron');
    const state = await page.evaluate(() => ({...window.ZudoSurfaceLab.state, image: null}));
    assert.equal(state.panelId, 'cad-3u-12hp');
    assert.equal(state.rotation, 15);
    assert.equal(state.seed, 99);
    assert.equal(state.thickness, 2.4);
    const again = await page.evaluate(() => window.ZudoSurfaceCore.recipe(window.ZudoSurfaceLab.getStudy()));
    assert.deepEqual(again.artwork.regions, saved.artwork.regions);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('checked-in fixtures match what the app produces today', async t => {
  if (!browser) return t.skip('Playwright/Chromium not installed');
  const {page, context} = await openLab(browser, server.base);
  try {
    for (const fixture of FIXTURES) {
      const recipe = await recipeFromApp(page, fixture);
      delete recipe.pathData;
      const stored = JSON.parse(readFileSync(join(root, 'examples', 'fixtures', `${fixture.name}.recipe.json`), 'utf8'));
      assert.deepEqual(recipe.artwork.regions, stored.artwork.regions, `${fixture.name} regions drifted; run npm run fixtures`);
      assert.deepEqual(recipe.panel, stored.panel);
    }
  } finally { await context.close(); }
});

test('Make 3MF: Generating → Validating → Download available', async t => {
  if (!browser) return t.skip('Playwright/Chromium not installed');
  const {page, errors, context} = await openLab(browser, server.base, {viewport: {width: 1280, height: 800}});
  try {
    await recipeFromApp(page, FIXTURES[1]);
    await page.click('#make3mf');
    await page.waitForSelector('#make3mfDialog[open]');
    await page.waitForFunction(() => /H2D/.test(document.getElementById('mfTemplate').textContent));
    assert.match(await page.textContent('#mfRegions'), /^35$/);
    assert.match(await page.textContent('#mfHeight'), /0\.36 mm/);
    assert.match(await page.textContent('#mfPanel'), /12 HP/);
    await page.click('#mfGenerate');
    await page.waitForSelector('#mfDownload:not([hidden])', {timeout: 30_000});
    assert.equal(await page.getAttribute('#mfSteps li[data-step=ready]', 'data-state'), 'done');
    assert.match(await page.textContent('#mfMessage'), /validation checks passed/);
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#mfDownload')]);
    assert.match(download.suggestedFilename(), /^zudo-blank-12hp-basket-weave-[0-9a-f]{8}\.3mf$/);
    const info = JSON.parse(execFileSync('python3', [join(root, 'scripts', 'generate_3mf.py'), 'inspect', await download.path()], {encoding: 'utf8'}));
    assert.equal(info.parts.filter(p => p.subtype === 'modifier_part').length, 35);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('preview-only designs cannot start generation', async t => {
  if (!browser) return t.skip('Playwright/Chromium not installed');
  const {page, context} = await openLab(browser, server.base);
  try {
    await page.evaluate(() => window.ZudoSurfaceLab.choosePattern('guilloche'));
    assert.equal(await page.locator('#make3mf').isDisabled(), true);
    assert.match(await page.textContent('#threeMfStatus'), /preview-only/);
  } finally { await context.close(); }
});

test('mobile layout: app usable and 3MF dialog fits the viewport', async t => {
  if (!browser) return t.skip('Playwright/Chromium not installed');
  const {page, errors, context} = await openLab(browser, server.base, {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, deviceScaleFactor: 1});
  try {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `horizontal overflow ${overflow}px`);
    await page.click('#make3mf');
    await page.waitForSelector('#make3mfDialog[open]');
    const box = await page.locator('#make3mfDialog').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 390, 'dialog within viewport width');
    assert.equal(await page.locator('#mfGenerate').isVisible(), true);
    await page.screenshot({path: join(root, '.tmp', 'e2e-mobile-3mf.png')});
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('every Directional regions pattern generates and validates on 1, 4, 12 and 20 HP panels', async t => {
  if (!browser) return t.skip('Playwright/Chromium not installed');
  const {page, context} = await openLab(browser, server.base);
  const dir = mkdtempSync(join(tmpdir(), 'zudo-sweep-'));
  try {
    const recipes = await page.evaluate(() => {
      const lab = window.ZudoSurfaceLab, out = [];
      const regional = window.ZudoPatterns.metadata.filter(m => m.kind === 'regional').map(m => m.id);
      for (const panelId of ['cad-3u-1hp', 'cad-3u-4hp', 'cad-3u-12hp', 'cad-3u-20hp']) for (const patternId of regional) {
        Object.assign(lab.state, lab.defaults, {image: null});
        lab.choosePattern(patternId);
        Object.assign(lab.state, {panelId, rotation: 23});
        lab.syncControls(); lab.refresh();
        const r = window.ZudoSurfaceCore.recipe(lab.getStudy());
        delete r.pathData;
        out.push(r);
      }
      return out;
    });
    assert.equal(recipes.length, 80);
    const failures = [];
    for (const [i, recipe] of recipes.entries()) {
      const file = join(dir, `${i}.json`);
      writeFileSync(file, JSON.stringify(recipe));
      try {
        execFileSync('python3', [join(root, 'scripts', 'generate_3mf.py'), 'generate', '--template', join(root, 'assets', 'h2d-empty.3mf'), '--recipe', file, '--output', join(dir, 'out.3mf')], {stdio: 'pipe'});
      } catch (error) { failures.push(`${recipe.panel.id}/${recipe.artwork.patternId}: ${error.stderr}`); }
    }
    assert.deepEqual(failures, []);
  } finally { await context.close(); rmSync(dir, {recursive: true, force: true}); }
});
