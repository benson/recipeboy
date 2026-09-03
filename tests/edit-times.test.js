import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/worker.js';
import { testDatabase } from './helpers/database.js';

test('recipe edits accept human times and calculate the stored total', async (t) => {
  const { sqlite, DB } = testDatabase();
  t.after(() => sqlite.close());
  const original = {
    title: 'Long roast', description: '', yield: '4 servings', prepMinutes: 0, cookMinutes: 0, totalMinutes: 0,
    ingredients: [{ amount: '1', unit: '', item: 'roast' }], instructions: ['Roast it.'], tags: ['30–60 min'],
  };
  sqlite.prepare('INSERT INTO recipes (id, title, data_json, created_at, created_by_user_id) VALUES (?, ?, ?, ?, ?)')
    .run('long-roast', original.title, JSON.stringify(original), '2026-09-03', 'friend');

  const response = await worker.fetch(new Request('http://localhost/recipes/long-roast', {
    method: 'PUT',
    headers: { Authorization: 'Bearer dev-token', 'X-Debug-User': 'friend', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...original,
      prepMinutes: '20 min',
      cookMinutes: '3 hours 15 minutes',
      ingredients: ['1 roast'],
    }),
  }), { DB, RECIPEBOY_AUTH_DISABLED: '1' });

  assert.equal(response.status, 200);
  const { recipe } = await response.json();
  assert.equal(recipe.prepMinutes, 20);
  assert.equal(recipe.cookMinutes, 195);
  assert.equal(recipe.totalMinutes, 215);
  assert.ok(recipe.tags.includes('1+ hours'));
  assert.ok(!recipe.tags.includes('30–60 min'));
  assert.equal(JSON.parse(sqlite.prepare('SELECT data_json FROM recipes WHERE id = ?').get('long-roast').data_json).totalMinutes, 215);
});

test('recipe edits reject time descriptions that cannot be normalized', async (t) => {
  const { sqlite, DB } = testDatabase();
  t.after(() => sqlite.close());
  const original = { title: 'Mystery stew', ingredients: [{ item: 'beans' }], instructions: ['Cook.'], tags: [] };
  sqlite.prepare('INSERT INTO recipes (id, title, data_json, created_at) VALUES (?, ?, ?, ?)')
    .run('mystery-stew', original.title, JSON.stringify(original), '2026-09-03');

  const response = await worker.fetch(new Request('http://localhost/recipes/mystery-stew', {
    method: 'PUT',
    headers: { Authorization: 'Bearer dev-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...original, prepMinutes: 'a little while', cookMinutes: '', ingredients: ['beans'] }),
  }), { DB, RECIPEBOY_AUTH_DISABLED: '1' });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /20 min/);
});
