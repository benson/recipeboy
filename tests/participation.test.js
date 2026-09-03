import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../worker/worker.js';
import { testDatabase } from './helpers/database.js';

function setup(t) {
  const { sqlite, DB } = testDatabase();
  t.after(() => sqlite.close());
  const recipe = { title: 'Shared supper', ingredients: [{ amount: '2', unit: 'cups', item: 'beans' }], instructions: ['Heat the beans.'], tags: [] };
  sqlite.prepare('INSERT INTO recipes (id, title, data_json, created_at, created_by_user_id) VALUES (?, ?, ?, ?, ?)')
    .run('supper', recipe.title, JSON.stringify(recipe), '2026-09-01T12:00:00Z', 'cook');
  for (const [id, name] of [['cook', 'Cook'], ['taster', 'Taster']]) {
    sqlite.prepare('INSERT INTO user_profiles (user_id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, name, '2026-09-01', '2026-09-01');
  }
  const env = { DB, RECIPEBOY_AUTH_DISABLED: '1' };
  const request = async (path, { method = 'GET', body, user = 'taster' } = {}) => {
    const response = await worker.fetch(new Request(`http://localhost/${path}`, {
      method,
      headers: { Authorization: 'Bearer dev-token', 'X-Debug-User': user, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), env);
    return { status: response.status, ...(await response.json()) };
  };
  return { sqlite, DB, env, request };
}

test('eaters can rate and edit a review without becoming cooks, including after reload', async (t) => {
  const { request } = setup(t);
  await request('recipes/supper/made', { method: 'POST', user: 'cook' });
  const first = await request('recipes/supper/ate', { method: 'POST' });
  assert.equal(first.status, 200);
  assert.equal(first.eatenCount, 1);
  assert.equal(first.madeCount, 1);
  assert.equal(first.madeByViewer, false);
  assert.equal(first.eatenByViewer, true);
  const second = await request('recipes/supper/ate', { method: 'POST' });
  assert.equal(second.alreadyEaten, true);
  assert.equal(second.eatenCount, 1);

  for (const rating of [5, 4]) {
    const review = await request('recipes/supper/review', { method: 'POST', body: { rating, review: 'Great dinner!', experience: 'ate' } });
    assert.equal(review.status, 200);
    assert.equal(review.madeCount, 1);
    assert.equal(review.madeByViewer, false);
    assert.equal(review.eatenCount, 1);
    assert.equal(review.ratingCount, 1);
    assert.equal(review.viewerExperience, 'ate');
  }
  const recipe = (await request('recipes')).recipes[0];
  assert.equal(recipe.viewerRating, 4);
  assert.equal(recipe.viewerExperience, 'ate');
  assert.equal(recipe.eaters[0].displayName, 'Taster');
  assert.equal(recipe.eaters[0].isViewer, true);
  assert.deepEqual(recipe.makers.map((p) => p.displayName), ['Cook']);
  assert.equal(recipe.reviews[0].experience, 'ate');

  const stats = (await request('stats')).stats;
  assert.deepEqual(stats.recipesCooked.map((p) => [p.displayName, p.count]), [['Cook', 1]]);
  assert.deepEqual(stats.reviewsWritten.map((p) => [p.displayName, p.count]), [['Taster', 1]]);
  const activity = (await request('activity')).activity;
  assert.equal(activity.filter((e) => e.type === 'ate').length, 1);
  assert.equal(activity.find((e) => e.type === 'ate').actor.displayName, 'Taster');
  assert.equal(activity.filter((e) => e.type === 'cooked').length, 1);

  const removed = await request('recipes/supper/review', { method: 'DELETE' });
  assert.equal(removed.viewerExperience, '');
  assert.equal(removed.ratingCount, 0);
  assert.equal((await request('recipes')).recipes[0].eatenCount, 1);
});

test('review role choices record only that role and preserve legacy cook counts', async (t) => {
  const { request, sqlite } = setup(t);
  sqlite.exec("UPDATE recipes SET made_count = 3 WHERE id = 'supper'");
  const ate = await request('recipes/supper/review', { method: 'POST', body: { rating: 5, experience: 'ate' } });
  assert.equal(ate.madeCount, 3);
  assert.equal(ate.eatenCount, 1);
  const cooked = await request('recipes/supper/review', { method: 'POST', user: 'cook', body: { rating: 4, experience: 'cooked' } });
  assert.equal(cooked.madeCount, 4);
  assert.equal(cooked.eatenByViewer, false);
  await request('recipes/supper/review', { method: 'POST', user: 'cook', body: { rating: 5, experience: 'cooked' } });
  const repeated = await request('recipes/supper/made', { method: 'POST', user: 'cook' });
  assert.equal(repeated.madeCount, 4);
  assert.equal(repeated.alreadyMade, true);
  // Someone can later cook a dish they previously only ate, without losing history.
  const laterCook = await request('recipes/supper/made', { method: 'POST' });
  assert.equal(laterCook.madeCount, 5);
  assert.equal(laterCook.eatenCount, 1);
  assert.equal(laterCook.eatenByViewer, true);
});

test('invalid reviews do not create participation and old clients stay compatible', async (t) => {
  const { request } = setup(t);
  assert.equal((await request('recipes/supper/review', { method: 'POST', body: { rating: 9, experience: 'ate' } })).status, 400);
  assert.equal((await request('recipes/supper/review', { method: 'POST', body: { rating: 5, experience: 'author' } })).status, 400);
  const oldReview = await request('recipes/supper/review', { method: 'POST', body: { rating: 5 } });
  assert.equal(oldReview.status, 200);
  assert.equal(oldReview.viewerExperience, '');
  assert.equal(oldReview.madeCount, 0);
  assert.equal(oldReview.eatenCount, 0);
});

test('participation and the review roll back together if the review cannot save', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { request, sqlite } = setup(t);
  sqlite.exec("CREATE TRIGGER fail_review BEFORE INSERT ON recipe_reviews BEGIN SELECT RAISE(ABORT, 'test save failure'); END;");
  for (const experience of ['ate', 'cooked']) {
    assert.equal((await request('recipes/supper/review', { method: 'POST', body: { rating: 5, experience } })).status, 500);
  }
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM recipe_eats').get().n, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM recipe_makes').get().n, 0);
  assert.equal(sqlite.prepare('SELECT made_count FROM recipes').get().made_count, 0);
});

test('eating requires auth, respects rate limits, and ignores deleted recipes', async (t) => {
  const { request, env, sqlite } = setup(t);
  assert.equal((await worker.fetch(new Request('https://recipeboy.test/recipes/supper/ate', { method: 'POST' }), { ...env, RECIPEBOY_AUTH_DISABLED: undefined })).status, 401);
  env.SOCIAL_RATE_LIMITER = { limit: async () => ({ success: false }) };
  assert.equal((await request('recipes/supper/ate', { method: 'POST' })).status, 429);
  delete env.SOCIAL_RATE_LIMITER;
  await request('recipes/supper/ate', { method: 'POST' });
  sqlite.exec("UPDATE recipes SET deleted_at = '2026-09-03' WHERE id = 'supper'");
  assert.equal((await request('recipes/supper/ate', { method: 'POST' })).status, 404);
  assert.equal((await request('recipes/missing/ate', { method: 'POST' })).status, 404);
  assert.equal((await request('activity')).activity.length, 0);
  assert.equal((await request('recipes')).recipes.length, 0);
});

test('eating migration preserves historical reviews without guessing a perspective', () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec(readFileSync(new URL('../worker/migrations/0004_social_profiles.sql', import.meta.url), 'utf8'));
    sqlite.exec("INSERT INTO recipe_reviews VALUES ('pie', 'friend', 5, 'Lovely', '2026-09-01', '2026-09-01')");
    sqlite.exec(readFileSync(new URL('../worker/migrations/0007_recipe_eats.sql', import.meta.url), 'utf8'));
    const review = sqlite.prepare('SELECT * FROM recipe_reviews').get();
    assert.equal(review.review_text, 'Lovely');
    assert.equal(review.rating, 5);
    assert.equal(review.experience, null);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM recipe_eats').get().n, 0);
  } finally { sqlite.close(); }
});
