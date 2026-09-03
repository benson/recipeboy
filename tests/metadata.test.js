import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeYield, yieldLabel, timeIsEstimated } from '../recipe-metadata.js';
import { normalizeRecipe, parseDuration } from '../worker/worker.js';
import { testDatabase } from './helpers/database.js';

test('unknown yields never render as zero servings and numeric yields have units', () => {
  for (const value of [0, '0', '0.0', 'Serves: 0', '0 servings', 'Makes 0 pies', '', null, 'unknown', 'N/A']) assert.equal(normalizeYield(value), '');
  assert.equal(normalizeYield(4), '4 servings');
  assert.equal(normalizeYield(['0', '8 bear claws']), '8 bear claws');
  assert.equal(normalizeYield(['8', '8 bear claws']), '8 bear claws');
  assert.equal(normalizeYield('1 9-inch pie'), '1 9-inch pie');
  assert.equal(normalizeYield('0.5 servings'), '0.5 servings');
  assert.equal(normalizeYield('4–6'), '4–6 servings');
  assert.equal(normalizeRecipe({ recipeYield: 'Serves: 0' }).yield, '');
  assert.equal(normalizeRecipe({ servings: 6 }).yield, '6 servings');
});

test('numeric-string durations survive imports and nonfinite durations do not', () => {
  assert.equal(parseDuration('45'), 45);
  assert.equal(parseDuration('PT1H15M'), 75);
  assert.equal(parseDuration(Infinity), 0);
  assert.equal(parseDuration(NaN), 0);
  assert.equal(normalizeRecipe({ prepTime: '15', cookTime: '30' }).totalMinutes, 45);
});

test('estimates stay visibly distinct without adding filler text', () => {
  const recipe = { yield: '4 servings', totalMinutes: 60, metadataEstimates: ['yield', 'totalMinutes'] };
  assert.equal(yieldLabel(recipe), '≈ 4 servings');
  assert.equal(yieldLabel(recipe, '8 servings'), '≈ 8 servings');
  assert.equal(timeIsEstimated(recipe), true);
  assert.equal(yieldLabel({ yield: '0', metadataEstimates: ['yield'] }), '');
  assert.equal(yieldLabel({ yield: '4' }), '4 servings');
  assert.equal(timeIsEstimated({ totalMinutes: 60 }), false);
});

test('metadata backfill is idempotent and preserves recipe content and cook records', (t) => {
  const { sqlite } = testDatabase();
  t.after(() => sqlite.close());
  const original = { title: 'Recipe', yield: '0', prepMinutes: 0, cookMinutes: 0, totalMinutes: 0, ingredients: ['Keep me'], instructions: ['Keep these too'], tags: ['friend'] };
  for (const [id, yieldValue] of [['7a2ccef0-34c', '0'], ['7c1c3fdb-9c5', 'Serves: 0'], ['24ce04c8-975', ''], ['a2aadd90-0ad', '6'], ['02f08f2c-80d', '1 9-inch pie'], ['021df416-905', '4'], ['c343222b-c8c', 'Serves 4 to 6'], ['unrelated', '0']]) {
    sqlite.prepare('INSERT INTO recipes (id, title, data_json, made_count, created_at) VALUES (?, ?, ?, 2, ?)').run(id, original.title, JSON.stringify({ ...original, yield: yieldValue }), '2026-09-01');
  }
  sqlite.prepare('INSERT INTO recipe_makes VALUES (?, ?, ?)').run('c343222b-c8c', 'user_3IhZjzmUHOoMbaqunIrcAl3cjec', '2026-08-31');
  const sql = readFileSync(new URL('../worker/migrations/0008_recipe_metadata_cleanup.sql', import.meta.url), 'utf8');
  sqlite.exec(sql);
  const snapshot = sqlite.prepare('SELECT * FROM recipes ORDER BY id').all();
  sqlite.exec(sql);
  assert.deepEqual(sqlite.prepare('SELECT * FROM recipes ORDER BY id').all(), snapshot);
  for (const row of snapshot) {
    const recipe = JSON.parse(row.data_json);
    assert.deepEqual(recipe.ingredients, original.ingredients);
    assert.deepEqual(recipe.instructions, original.instructions);
    assert.deepEqual(recipe.tags, original.tags);
    assert.equal(row.made_count, row.id === 'c343222b-c8c' ? 1 : 2);
    if (row.id === 'unrelated') assert.deepEqual(recipe, original);
  }
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM recipe_makes').get().count, 1);
  const salmon = JSON.parse(snapshot.find((row) => row.id === '24ce04c8-975').data_json);
  assert.equal(salmon.yield, '');
  assert.equal(salmon.totalMinutes, 30);
});

test('backfill guards preserve later edits and other friends cooking the halal recipe', (t) => {
  const { sqlite } = testDatabase();
  t.after(() => sqlite.close());
  const edited = { yield: '3 servings', prepMinutes: 15, cookMinutes: 0, totalMinutes: 0 };
  for (const id of ['24ce04c8-975', 'c343222b-c8c']) sqlite.prepare('INSERT INTO recipes (id, title, data_json, made_count, created_at) VALUES (?, ?, ?, 2, ?)').run(id, 'Edited recipe', JSON.stringify(edited), '2026-09-01');
  for (const user of ['user_3IhZjzmUHOoMbaqunIrcAl3cjec', 'another-friend']) sqlite.prepare('INSERT INTO recipe_makes VALUES (?, ?, ?)').run('c343222b-c8c', user, '2026-09-01');
  sqlite.exec(readFileSync(new URL('../worker/migrations/0008_recipe_metadata_cleanup.sql', import.meta.url), 'utf8'));
  for (const row of sqlite.prepare('SELECT data_json, made_count FROM recipes').all()) {
    assert.deepEqual(JSON.parse(row.data_json), edited);
    assert.equal(row.made_count, 2);
  }
});
