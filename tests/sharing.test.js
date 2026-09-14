import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/worker.js';
import { testDatabase } from './helpers/database.js';

function setup(t, overrides = {}) {
  const { sqlite, DB } = testDatabase();
  t.after(() => sqlite.close());
  const recipe = {
    title: 'Sunday tomato soup', description: 'Roasted tomatoes with basil and cream.',
    yield: '4 servings', totalMinutes: 45, ingredients: [{ item: 'tomatoes' }, { item: 'basil' }],
    instructions: ['Roast, blend, and serve.'], imageUrl: 'https://example.com/soup.jpg', ...overrides,
  };
  const save = () => sqlite.prepare('UPDATE recipes SET title = ?, data_json = ? WHERE id = ?').run(recipe.title, JSON.stringify(recipe), 'soup');
  sqlite.prepare('INSERT INTO recipes (id, title, data_json, created_at) VALUES (?, ?, ?, ?)')
    .run('soup', recipe.title, JSON.stringify(recipe), '2026-09-14');
  const request = (path = '/share/soup', options = {}) => worker.fetch(new Request(`https://recipeboy-api.bensonperry.workers.dev${path}`, options), { DB });
  const addPhoto = (id, date, deleted = null) => sqlite.prepare('INSERT INTO recipe_photos (id, recipe_id, user_id, object_key, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, 'soup', 'friend', `soup/${id}.webp`, date, deleted);
  return { sqlite, recipe, save, request, addPhoto };
}

test('anonymous crawlers receive recipe metadata in a 200 HTML response without following a redirect', async (t) => {
  const { request } = setup(t);
  const response = await request('/share/soup?tracking=ignored', { headers: { 'User-Agent': 'facebookexternalhit/1.1' } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Type'), /^text\/html/);
  assert.equal(response.headers.get('Location'), null);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const html = await response.text();
  assert.match(html, /<title>Sunday tomato soup · Recipeboy<\/title>/);
  assert.match(html, /property="og:title" content="Sunday tomato soup"/);
  assert.match(html, /name="twitter:title" content="Sunday tomato soup"/);
  assert.match(html, /property="og:description" content="Roasted tomatoes with basil and cream\."/);
  assert.match(html, /name="twitter:description" content="Roasted tomatoes with basil and cream\."/);
  assert.match(html, /property="og:url" content="https:\/\/recipeboy-api\.bensonperry\.workers\.dev\/share\/soup"/);
  assert.match(html, /rel="canonical" href="https:\/\/recipeboy-api\.bensonperry\.workers\.dev\/share\/soup"/);
  assert.match(html, /property="og:image" content="https:\/\/example\.com\/soup\.jpg"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /location\.replace\("https:\/\/recipeboy\.bensonperry\.com\/#recipe=soup"\)/);
  assert.match(html, /href="https:\/\/recipeboy\.bensonperry\.com\/#recipe=soup">Open recipe/);
  assert.doesNotMatch(html, /http-equiv="refresh"|RECIPEBOY JOY|mascot/);
  const nonce = html.match(/<script nonce="([^"]+)"/)[1];
  assert.ok(response.headers.get('Content-Security-Policy').includes(`'nonce-${nonce}'`));
  const head = await request('/share/soup', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.match(head.headers.get('Content-Type'), /^text\/html/);
  assert.equal(await head.text(), '');
});

test('shares follow live edits and prefer the latest active meal photo, then the source image', async (t) => {
  const { request, recipe, save, addPhoto, sqlite } = setup(t);
  addPhoto('older', '2026-09-01');
  addPhoto('newer', '2026-09-10');
  addPhoto('deleted', '2026-09-14', '2026-09-14');
  assert.match(await (await request()).text(), /property="og:image" content="https:\/\/recipeboy-api\.bensonperry\.workers\.dev\/photos\/soup%2Fnewer\.webp"/);
  recipe.title = 'Creamy tomato soup';
  recipe.description = 'The new recipe description.';
  save();
  sqlite.prepare('UPDATE recipe_photos SET deleted_at = ? WHERE id = ?').run('2026-09-14', 'newer');
  const edited = await (await request()).text();
  assert.match(edited, /property="og:title" content="Creamy tomato soup"/);
  assert.match(edited, /property="og:description" content="The new recipe description\."/);
  assert.match(edited, /soup%2Folder\.webp/);
  sqlite.prepare('UPDATE recipe_photos SET deleted_at = ?').run('2026-09-14');
  assert.match(await (await request()).text(), /property="og:image" content="https:\/\/example\.com\/soup\.jpg"/);
});

test('sparse recipes get useful recipe-specific text without a generic mascot preview', async (t) => {
  const { request } = setup(t, { description: '', imageUrl: '', metadataEstimates: ['totalMinutes', 'yield'] });
  const html = await (await request()).text();
  assert.match(html, /property="og:description" content="≈ 4 servings · ≈ 45 min · With tomatoes, basil"/);
  assert.match(html, /name="twitter:card" content="summary"/);
  assert.doesNotMatch(html, /og:image|twitter:image|mascot/);
});

test('missing, malformed, and deleted links return 404 without exposing old recipe content', async (t) => {
  const { request, sqlite } = setup(t);
  sqlite.prepare('UPDATE recipes SET deleted_at = ?').run('2026-09-14');
  for (const path of ['/share/soup', '/share/missing', '/share/', '/share/%3Cscript%3E']) {
    const response = await request(path);
    assert.equal(response.status, 404);
    const html = await response.text();
    assert.match(html, /Recipe unavailable/);
    assert.doesNotMatch(html, /Sunday tomato soup|Roasted tomatoes|og:image|location\.replace/);
  }
});

test('recipe content cannot escape metadata, body markup, or the fixed redirect', async (t) => {
  const { request, recipe, save } = setup(t, {
    title: 'Soup </title><script>alert(1)</script> & "friends"',
    description: '"><img src=x onerror=alert(2)>', imageUrl: 'javascript:alert(3)',
  });
  const html = await (await request()).text();
  assert.match(html, /&lt;\/title&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;friends&quot;/);
  assert.match(html, /&quot;&gt;&lt;img src=x onerror=alert\(2\)&gt;/);
  assert.equal((html.match(/<script/g) || []).length, 1);
  assert.doesNotMatch(html, /<img|javascript:|og:image/);
  recipe.imageUrl = 'http://127.0.0.1/private.png';
  save();
  assert.doesNotMatch(await (await request()).text(), /og:image|private\.png/);
  recipe.imageUrl = 'https://user:password@example.com/private.png';
  save();
  assert.doesNotMatch(await (await request()).text(), /og:image|password/);
});
