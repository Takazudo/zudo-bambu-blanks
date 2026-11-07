// Regenerate examples/fixtures/*.recipe.json from the real Surface Lab in Chromium.
// Preview-only pathData is dropped (the generator never reads it), everything else is verbatim.
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {FIXTURES, launchBrowser, openLab, recipeFromApp, startServer} from '../tests/support/harness.mjs';
import {root} from './server.mjs';

const server = await startServer();
const browser = await launchBrowser();
if (!browser) throw new Error('Playwright is required: npm install && npx playwright install chromium');
try {
  const {page} = await openLab(browser, server.base);
  for (const fixture of FIXTURES) {
    const recipe = await recipeFromApp(page, fixture);
    delete recipe.pathData;
    const file = join(root, 'examples', 'fixtures', `${fixture.name}.recipe.json`);
    writeFileSync(file, JSON.stringify(recipe, null, 1) + '\n');
    console.log(`${fixture.name}: ${recipe.artwork.regions.length} regions (${recipe.artwork.kind})`);
  }
} finally {
  await browser.close();
  await server.stop();
}
