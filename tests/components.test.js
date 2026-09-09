import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/worker.js';
import { componentIds, shoppingGroups } from '../recipe-components.js';
import { testDatabase } from './helpers/database.js';

function setup(t) {
  const { sqlite, DB } = testDatabase();
  t.after(() => sqlite.close());
  const base = { title: 'Pico', description: '', yield: '4 servings', ingredients: [{ amount: '6', item: 'tomatoes' }], instructions: ['Dice and mix.'], tags: [] };
  for (const [id, title, links] of [['pico', 'Pico', []], ['onions', 'Pickled onions', []], ['meal', 'Taco night', ['pico']]]) {
    sqlite.prepare('INSERT INTO recipes (id, title, data_json, created_at, created_by_user_id) VALUES (?, ?, ?, ?, ?)')
      .run(id, title, JSON.stringify({ ...base, title, componentRecipeIds: links }), '2026-09-09', 'friend');
  }
  const env = { DB, RECIPEBOY_AUTH_DISABLED: '1' };
  async function request(path, method = 'GET', body, authenticated = true) {
    return worker.fetch(new Request(`http://localhost${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: 'Bearer dev-token', 'X-Debug-User': 'friend' } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), env);
  }
  const edit = (componentRecipeIds) => ({ ...base, title: 'Taco night', ingredients: ['8 flour tortillas'], ...(componentRecipeIds === undefined ? {} : { componentRecipeIds }) });
  const stored = (id) => JSON.parse(sqlite.prepare('SELECT data_json FROM recipes WHERE id = ?').get(id).data_json);
  return { sqlite, env, request, edit, stored };
}

test('linked meals retain ordered references and independent components on create, edit and public read', async (t) => {
  const { request, edit, stored } = setup(t);
  const created = await request('/recipes', 'POST', {
    input: 'Another taco night\nIngredients\n8 flour tortillas\nInstructions\nWarm the tortillas and serve the linked recipes.',
    componentRecipeIds: ['onions', 'pico'],
  });
  assert.equal(created.status, 201);
  const { recipe } = await created.json();
  assert.deepEqual(recipe.componentRecipeIds, ['onions', 'pico']);
  assert.equal(recipe.addedBy.isViewer, true);
  assert.equal((await request('/recipes/meal', 'PUT', edit(['onions', 'pico', 'onions']))).status, 200);
  assert.deepEqual(stored('meal').componentRecipeIds, ['onions', 'pico']);
  assert.equal(stored('pico').title, 'Pico');
  const publicBox = await (await request('/recipes', 'GET', undefined, false)).json();
  assert.deepEqual(publicBox.recipes.find((item) => item.id === 'meal').componentRecipeIds, ['onions', 'pico']);
  assert.equal(publicBox.recipes.find((item) => item.id === 'pico').canEdit, false);
});

test('self-links, indirect cycles, invalid IDs, missing recipes and oversized lists are rejected without changing the recipe', async (t) => {
  const { request, edit, stored } = setup(t);
  const before = stored('pico');
  for (const ids of [['pico'], ['meal'], ['missing'], ['<script>'], [null], 'pico', Array(17).fill('onions')]) {
    const response = await request('/recipes/pico', 'PUT', edit(ids));
    assert.equal(response.status, 400, JSON.stringify(ids));
    assert.deepEqual(stored('pico'), before);
  }
});

test('old clients preserve links; a meal can use only component ingredients; unlinking never deletes the component', async (t) => {
  const { request, edit, stored } = setup(t);
  assert.equal((await request('/recipes/meal', 'PUT', edit())).status, 200);
  assert.deepEqual(stored('meal').componentRecipeIds, ['pico']);
  assert.equal((await request('/recipes/meal', 'PUT', { ...edit(['pico']), ingredients: [] })).status, 200);
  assert.equal((await request('/recipes/meal', 'PUT', { ...edit([]), ingredients: [] })).status, 400);
  assert.equal((await request('/recipes/meal', 'PUT', edit([]))).status, 200);
  assert.deepEqual(stored('meal').componentRecipeIds, []);
  assert.equal(stored('pico').title, 'Pico');
});

test('deleted components remain recoverable links but cannot be newly selected', async (t) => {
  const { request, edit, stored } = setup(t);
  assert.equal((await request('/recipes/pico', 'DELETE')).status, 200);
  assert.equal((await request('/recipes/meal', 'PUT', edit(['pico']))).status, 200);
  assert.equal((await request('/recipes/onions', 'PUT', edit(['pico']))).status, 400);
  const { recipes } = await (await request('/recipes')).json();
  const groups = shoppingGroups(recipes.find((recipe) => recipe.id === 'meal'), recipes);
  assert.deepEqual(groups[1], { id: 'pico', missing: true });
  assert.equal((await request('/recipes/pico/restore', 'POST')).status, 200);
  const restored = await (await request('/recipes')).json();
  assert.equal(shoppingGroups(restored.recipes.find((recipe) => recipe.id === 'meal'), restored.recipes)[1].title, 'Pico');
  assert.deepEqual(stored('meal').componentRecipeIds, ['pico']);
});

test('shopping lists traverse nested meals once and terminate even on old cyclic data', () => {
  const recipes = [
    { id: 'party', componentRecipeIds: ['meal', 'pico'] },
    { id: 'meal', componentRecipeIds: ['pico', 'missing'] },
    { id: 'pico', componentRecipeIds: ['party'] },
  ];
  assert.deepEqual(shoppingGroups(recipes[0], recipes).map((group) => group.id), ['party', 'meal', 'pico', 'missing']);
  assert.deepEqual(componentIds({}), []);
});

test('link mutations keep existing authentication and rate-limit gates', async (t) => {
  const { env, request, edit, stored } = setup(t);
  env.RECIPEBOY_AUTH_DISABLED = '0';
  assert.equal((await request('/recipes/meal', 'PUT', edit(['onions']), false)).status, 401);
  env.RECIPEBOY_AUTH_DISABLED = '1';
  env.SOCIAL_RATE_LIMITER = { limit: async () => ({ success: false }) };
  assert.equal((await request('/recipes/meal', 'PUT', edit(['onions']))).status, 429);
  assert.deepEqual(stored('meal').componentRecipeIds, ['pico']);
});

test('editing links preserves a recipe total that includes resting time', async (t) => {
  const { sqlite, request, edit, stored } = setup(t);
  sqlite.prepare('UPDATE recipes SET data_json = ? WHERE id = ?')
    .run(JSON.stringify({ ...stored('meal'), prepMinutes: 15, cookMinutes: 0, totalMinutes: 45 }), 'meal');
  const response = await request('/recipes/meal', 'PUT', { ...edit(['pico', 'onions']), prepMinutes: '15 min', cookMinutes: '' });
  assert.equal(response.status, 200);
  assert.equal(stored('meal').totalMinutes, 45);
});
