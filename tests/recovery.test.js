import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../worker/worker.js';
import { testDatabase } from './helpers/database.js';

function setup(t) {
  const { sqlite, DB } = testDatabase();
  t.after(() => sqlite.close());
  const recipe = { title: 'Cookies', ingredients: [{ item: 'chocolate' }], instructions: ['Bake.'], tags: [] };
  sqlite.prepare('INSERT INTO recipes (id, title, data_json, created_at, made_count) VALUES (?, ?, ?, ?, ?)')
    .run('cookies', recipe.title, JSON.stringify(recipe), '2026-09-04', 3);
  sqlite.prepare('INSERT INTO recipe_photos (id, recipe_id, user_id, object_key, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('photo-1', 'cookies', 'matt', 'cookies/original.webp', '2026-09-04');
  let objectDeletes = 0;
  const env = {
    DB, RECIPEBOY_AUTH_DISABLED: '1',
    PHOTOS: {
      async get() { return { body: 'original-photo-bytes', httpEtag: 'test-etag', httpMetadata: { contentType: 'image/webp' } }; },
      async delete() { objectDeletes++; },
    },
  };
  const request = (path, method = 'GET', user = 'matt') => worker.fetch(new Request(`http://localhost${path}`, {
    method, headers: { Authorization: 'Bearer dev-token', 'X-Debug-User': user },
  }), env);
  return { sqlite, env, request, objectDeletes: () => objectDeletes };
}

test('deleted photos retain their original object and can be restored after reloading', async (t) => {
  const { sqlite, request, objectDeletes } = setup(t);
  assert.equal((await request('/recipes/cookies/photos/photo-1', 'DELETE')).status, 200);
  assert.ok(sqlite.prepare('SELECT deleted_at FROM recipe_photos WHERE id = ?').get('photo-1').deleted_at);
  assert.equal(objectDeletes(), 0);
  assert.equal((await (await request('/recipes')).json()).recipes[0].photos.length, 0);
  assert.equal((await request('/photos/cookies%2Foriginal.webp')).status, 404);
  const deleted = (await (await request('/trash')).json()).items;
  assert.equal(deleted[0].kind, 'photo');
  assert.equal(deleted[0].id, 'photo-1');
  assert.equal((await request('/recipes/cookies/photos/photo-1/restore', 'POST')).status, 200);
  const restored = (await (await request('/recipes')).json()).recipes[0].photos[0];
  assert.equal(restored.id, 'photo-1');
  assert.equal(restored.url, '/photos/cookies%2Foriginal.webp');
  assert.equal(restored.addedAt, '2026-09-04');
  assert.equal(await (await request('/photos/cookies%2Foriginal.webp')).text(), 'original-photo-bytes');
  assert.equal((await (await request('/trash')).json()).items.length, 0);
});

test('recipe recovery keeps photos and social records, with separately deleted photos still recoverable', async (t) => {
  const { sqlite, request } = setup(t);
  sqlite.prepare('INSERT INTO recipe_makes VALUES (?, ?, ?)').run('cookies', 'matt', '2026-09-04');
  await request('/recipes/cookies/photos/photo-1', 'DELETE');
  await request('/recipes/cookies', 'DELETE');
  assert.equal((await request('/recipes/cookies/photos/photo-1/restore', 'POST')).status, 409);
  const trash = (await (await request('/trash')).json()).items;
  assert.ok(trash.some((item) => item.kind === 'recipe' && item.id === 'cookies'));
  assert.equal(trash.find((item) => item.kind === 'photo').needsRecipe, 1);
  assert.equal((await request('/recipes/cookies/restore', 'POST')).status, 200);
  assert.equal((await request('/recipes/cookies/photos/photo-1/restore', 'POST')).status, 200);
  const recipe = (await (await request('/recipes')).json()).recipes[0];
  assert.equal(recipe.madeCount, 3);
  assert.equal(recipe.makers.length, 1);
  assert.equal(recipe.photos.length, 1);
});

test('deleted personal lists preserve membership and are only restorable by their owner', async (t) => {
  const { sqlite, request } = setup(t);
  sqlite.prepare('INSERT INTO recipe_lists VALUES (?, ?, ?, ?, ?)').run('baking', 'matt', 'Baking', '2026-09-04', '2026-09-05');
  sqlite.prepare('INSERT INTO recipe_list_items VALUES (?, ?, ?)').run('baking', 'cookies', '2026-09-05');
  assert.equal((await request('/lists/baking', 'DELETE')).status, 200);
  const item = (await (await request('/trash')).json()).items[0];
  assert.equal(item.kind, 'list');
  assert.equal((await (await request('/trash', 'GET', 'other')).json()).items.length, 0);
  assert.equal((await request(`/trash/${item.id}/restore`, 'POST', 'other')).status, 404);
  sqlite.prepare('INSERT INTO recipe_lists VALUES (?, ?, ?, ?, ?)').run('new-list', 'matt', 'Baking', '2026-09-06', '2026-09-06');
  assert.equal((await request(`/trash/${item.id}/restore`, 'POST')).status, 409);
  sqlite.prepare('UPDATE recipe_lists SET name = ? WHERE id = ?').run('New baking', 'new-list');
  assert.equal((await request(`/trash/${item.id}/restore`, 'POST')).status, 200);
  assert.deepEqual({ ...sqlite.prepare('SELECT * FROM recipe_list_items WHERE list_id = ?').get('baking') }, {
    list_id: 'baking', recipe_id: 'cookies', created_at: '2026-09-05',
  });
  assert.equal(sqlite.prepare('SELECT created_at FROM recipe_lists WHERE id = ?').get('baking').created_at, '2026-09-04');
});

test('review recovery preserves rating, text and participation without overwriting a newer review', async (t) => {
  const { sqlite, request } = setup(t);
  sqlite.prepare('INSERT INTO recipe_reviews VALUES (?, ?, ?, ?, ?, ?, ?)').run('cookies', 'matt', 5, 'Lovely!', 'cooked', '2026-09-04', '2026-09-05');
  await request('/recipes/cookies/review', 'DELETE');
  const item = (await (await request('/trash')).json()).items[0];
  assert.equal(item.kind, 'review');
  sqlite.prepare('INSERT INTO recipe_reviews VALUES (?, ?, ?, ?, ?, ?, ?)').run('cookies', 'matt', 4, 'New review', 'ate', '2026-09-06', '2026-09-06');
  assert.equal((await request(`/trash/${item.id}/restore`, 'POST')).status, 409);
  assert.equal(sqlite.prepare('SELECT review_text FROM recipe_reviews').get().review_text, 'New review');
  await request('/recipes/cookies/review', 'DELETE');
  assert.equal((await request(`/trash/${item.id}/restore`, 'POST')).status, 200);
  const restored = sqlite.prepare('SELECT * FROM recipe_reviews').get();
  assert.equal(restored.review_text, 'Lovely!');
  assert.equal(restored.rating, 5);
  assert.equal(restored.experience, 'cooked');
  assert.equal(restored.updated_at, '2026-09-05');
  assert.equal(sqlite.prepare('SELECT made_count FROM recipes').get().made_count, 3);
});

test('list deletion archives and removes data atomically', async (t) => {
  const { sqlite, request } = setup(t);
  sqlite.prepare('INSERT INTO recipe_lists VALUES (?, ?, ?, ?, ?)').run('baking', 'matt', 'Baking', '2026-09-04', '2026-09-05');
  sqlite.prepare('INSERT INTO recipe_list_items VALUES (?, ?, ?)').run('baking', 'cookies', '2026-09-05');
  sqlite.exec("CREATE TRIGGER refuse_delete BEFORE DELETE ON recipe_lists BEGIN SELECT RAISE(ABORT, 'test failure'); END;");
  assert.equal((await request('/lists/baking', 'DELETE')).status, 500);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM deleted_items').get().count, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM recipe_list_items').get().count, 1);
});

test('recovery requires authentication, respects rate limits, and cannot bypass the photo cap', async (t) => {
  const { sqlite, env, request } = setup(t);
  assert.equal((await worker.fetch(new Request('https://recipeboy-api.bensonperry.workers.dev/trash'), { ...env, RECIPEBOY_AUTH_DISABLED: undefined })).status, 401);
  await request('/recipes/cookies/photos/photo-1', 'DELETE');
  env.SOCIAL_RATE_LIMITER = { async limit() { return { success: false }; } };
  assert.equal((await request('/recipes/cookies/photos/photo-1/restore', 'POST')).status, 429);
  delete env.SOCIAL_RATE_LIMITER;
  for (let i = 0; i < 12; i++) sqlite.prepare('INSERT INTO recipe_photos (id, recipe_id, user_id, object_key, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(`extra-${i}`, 'cookies', 'matt', `cookies/${i}.webp`, '2026-09-05');
  assert.equal((await request('/recipes/cookies/photos/photo-1/restore', 'POST')).status, 409);
  assert.ok(sqlite.prepare('SELECT deleted_at FROM recipe_photos WHERE id = ?').get('photo-1').deleted_at);
});

test('recovery migration preserves existing photo records as active', (t) => {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec("CREATE TABLE recipe_photos (id TEXT PRIMARY KEY, object_key TEXT); INSERT INTO recipe_photos VALUES ('old', 'original.webp');");
  sqlite.exec(readFileSync(new URL('../worker/migrations/0009_recoverable_deletions.sql', import.meta.url), 'utf8'));
  const photo = sqlite.prepare('SELECT * FROM recipe_photos').get();
  assert.equal(photo.object_key, 'original.webp');
  assert.equal(photo.deleted_at, null);
});
