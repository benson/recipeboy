// Read-only production check. Open Recipeboy with the Playwright CLI, then run this file.
async (page) => {
  const api = 'https://recipeboy-api.bensonperry.workers.dev';
  const site = 'https://recipeboy.bensonperry.com';
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const { recipes } = await (await page.request.get(`${api}/recipes`)).json();
  const recipe = recipes.find((item) => item.photos?.length) || recipes[0];
  assert(recipe, 'The box must have a recipe to check');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`${site}/#recipe=${recipe.id}`);
  const dialog = page.locator('#recipe-dialog');
  await dialog.getByRole('heading', { name: recipe.title, exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'More recipe actions' }).click();
  await dialog.getByRole('menuitem', { name: 'Copy recipe link' }).click();
  const shared = await page.evaluate(() => navigator.clipboard.readText());
  assert(shared === `${api}/share/${recipe.id}`, 'Copy recipe link must use the crawler-readable URL');
  const crawler = await page.request.get(shared, { headers: { 'User-Agent': 'facebookexternalhit/1.1' } });
  assert(crawler.status() === 200, 'The crawler must get a successful HTML page');
  const html = await crawler.text();
  assert(html.includes('property="og:title"') && !html.includes('RECIPEBOY JOY'), 'Raw HTML must contain recipe metadata');
  // Read the actual DOM without JavaScript, exactly as a basic unfurler would.
  const previewContext = await page.context().browser().newContext({ javaScriptEnabled: false });
  try {
    const preview = await previewContext.newPage();
    await preview.goto(shared);
    assert(await preview.locator('meta[property="og:title"]').getAttribute('content') === recipe.title, 'Preview title must match the recipe');
    assert(await preview.locator('meta[name="twitter:title"]').getAttribute('content') === recipe.title, 'Twitter title must match the recipe');
    assert(await preview.locator('meta[property="og:url"]').getAttribute('content') === shared, 'Preview canonical URL must identify this recipe');
    const image = await preview.locator('meta[property="og:image"]').getAttribute('content').catch(() => null);
    if (recipe.photos?.length) {
      assert(image?.startsWith(`${api}/photos/`), 'Meal photo must be used in the preview');
      const response = await page.request.get(image);
      assert(response.ok() && response.headers()['content-type']?.startsWith('image/'), 'The preview photo must be publicly readable');
    }
    assert(await preview.getByRole('link', { name: 'Open recipe in Recipeboy' }).getAttribute('href') === `${site}/#recipe=${recipe.id}`, 'No-JavaScript fallback must open the recipe');
  } finally {
    await previewContext.close();
  }
  await page.goto(shared);
  await page.waitForURL(`${site}/#recipe=${recipe.id}`);
  await dialog.getByRole('heading', { name: recipe.title, exact: true }).waitFor();
  return { recipe: recipe.title, shareUrl: shared, preview: 'recipe metadata and public photo verified', opened: page.url() };
}
