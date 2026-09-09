// Run with the Playwright CLI's run-code --filename option while npm run dev serves port 4173.
// Browser-only fixtures: this check never writes to the live recipe box.
async (page) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const profile = { displayName: 'Recipe tester', avatar: {} };
  const base = { description: 'A recipe to share.', yield: '4 servings', prepMinutes: 10, cookMinutes: 20, totalMinutes: 30, tags: [], instructions: ['Prepare and serve.'], photos: [], makers: [], eaters: [], reviews: [], canEdit: true, addedBy: profile, createdAt: '2026-09-09' };
  const recipes = [
    { ...base, id: 'meal', title: 'Taco night', ingredients: [{ amount: '8', item: 'flour tortillas' }], componentRecipeIds: ['beef', 'pico', 'onions'] },
    { ...base, id: 'beef', title: 'Braised beef', ingredients: [{ amount: '2', unit: 'lb', item: 'beef' }] },
    { ...base, id: 'pico', title: 'Fresh pico', prepMinutes: 15, cookMinutes: 0, totalMinutes: 30, ingredients: [{ amount: '6', item: 'tomatoes' }] },
    { ...base, id: 'onions', title: 'Pickled onions', ingredients: [{ amount: '1', item: 'red onion' }] },
    { ...base, id: 'rice', title: 'Cilantro rice', ingredients: [{ amount: '1', unit: 'cup', item: 'rice' }] },
  ];
  let createdLinks;
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  await page.route('http://127.0.0.1:8791/**', async (route) => {
    const request = route.request();
    const path = request.url().replace('http://127.0.0.1:8791', '').split('?')[0];
    let response = {};
    if (path === '/recipes' && request.method() === 'GET') response = { recipes };
    else if (path === '/recipes' && request.method() === 'POST') {
      createdLinks = request.postDataJSON().componentRecipeIds;
      const recipe = { ...base, id: 'new-meal', title: 'Sunday supper', componentRecipeIds: createdLinks, ingredients: [{ item: 'tortillas' }] };
      recipes.unshift(recipe);
      response = { recipe };
    } else if (path.startsWith('/recipes/') && request.method() === 'PUT') {
      const recipe = recipes.find((item) => item.id === path.split('/')[2]);
      const body = request.postDataJSON();
      Object.assign(recipe, body, { ingredients: body.ingredients.map((item) => ({ item })) });
      response = { recipe };
    } else if (path === '/lists') response = { lists: [] };
    else if (path.startsWith('/profile')) response = { profile };
    await route.fulfill({ json: response, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
  });
  await page.goto('http://127.0.0.1:4173/?auth=dev');
  await page.getByRole('button', { name: 'Open Taco night', exact: true }).click();
  const dialog = page.locator('#recipe-dialog');
  assert(await dialog.locator('[data-linked-recipe]').count() === 3, 'Meal must show three recipe links');
  await dialog.getByRole('link', { name: /Fresh pico/ }).click();
  assert(page.url().endsWith('#recipe=pico'), 'Component must have its own permalink');
  assert(await dialog.getByRole('heading', { name: 'Part of', exact: true }).isVisible(), 'Component must show parent meal');
  await page.goBack();
  await dialog.getByRole('heading', { name: 'Taco night', exact: true }).waitFor();
  assert(await page.evaluate(() => document.activeElement?.textContent) === 'Taco night', 'Navigation must focus the new recipe heading');
  assert(await dialog.locator('.dialog-shell').evaluate((element) => element.scrollTop) === 0, 'Opening a linked recipe must start at its title');

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await dialog.getByRole('button', { name: 'Copy shopping list', exact: true }).filter({ visible: true }).click();
  const shopping = await page.evaluate(() => navigator.clipboard.readText());
  assert(['8 flour tortillas', '2 lb beef', '6 tomatoes', '1 red onion'].every((text) => shopping.includes(text)), 'Meal shopping list must include all component quantities');

  await dialog.getByRole('button', { name: 'More recipe actions' }).click();
  await dialog.getByRole('menuitem', { name: 'Edit recipe' }).click();
  const editor = page.locator('#edit-dialog');
  await editor.getByRole('searchbox', { name: 'Find a recipe to link' }).fill('rice');
  await editor.locator('[data-component-add="rice"]').click();
  await editor.getByRole('button', { name: 'Move Cilantro rice up', exact: true }).click();
  await editor.getByRole('button', { name: 'Unlink Pickled onions', exact: true }).click();
  await editor.getByRole('button', { name: 'Save recipe', exact: true }).click();
  await editor.waitFor({ state: 'hidden' });
  assert(JSON.stringify(recipes.find((recipe) => recipe.id === 'meal').componentRecipeIds) === JSON.stringify(['beef', 'pico', 'rice']), 'Editor must save ordered add/remove choices');
  assert(recipes.some((recipe) => recipe.id === 'onions'), 'Unlinking must not delete a recipe');

  await dialog.getByRole('link', { name: /Fresh pico/ }).click();
  await dialog.getByRole('button', { name: 'More recipe actions' }).click();
  await dialog.getByRole('menuitem', { name: 'Edit recipe' }).click();
  await editor.getByRole('searchbox', { name: 'Find a recipe to link' }).fill('Taco');
  assert(await editor.locator('[data-edit-total-time]').textContent() === '30 min', 'Editor total must preserve resting time');
  assert(await editor.locator('[data-component-add="meal"]').count() === 0, 'Picker must exclude circular links');
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await dialog.getByRole('button', { name: 'Close recipe', exact: true }).click();

  await page.getByRole('button', { name: 'Feed Recipeboy a recipe' }).click();
  const add = page.locator('#add-recipe-dialog');
  await add.getByRole('textbox', { name: 'Recipe URL or recipe text' }).fill('Sunday supper\nIngredients\ntortillas\nInstructions\nServe with pico.');
  await add.locator('summary').click();
  await add.getByRole('searchbox', { name: 'Find a recipe to link' }).fill('pico');
  await add.locator('[data-component-add="pico"]').click();
  await add.getByRole('button', { name: 'Feed him!' }).click();
  await dialog.getByRole('heading', { name: 'Sunday supper', exact: true }).waitFor();
  assert(JSON.stringify(createdLinks) === '["pico"]', 'New meals must carry selected links through import');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:4173/?auth=dev#recipe=meal');
  await dialog.getByRole('heading', { name: 'Taco night', exact: true }).waitFor();
  const overflow = await dialog.evaluate((element) => element.scrollWidth > element.clientWidth + 1);
  assert(!overflow, 'Meal detail must fit a phone viewport');
  await page.screenshot({ path: 'output/playwright/recipe-links-mobile.png' });
  return { passed: ['component links and backlinks', 'browser back and focus', 'complete shopping list', 'editor add/reorder/unlink', 'cycle exclusion', 'linked recipe creation', 'mobile layout'], screenshot: 'output/playwright/recipe-links-mobile.png' };
}
