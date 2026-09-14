import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../worker/worker.js';
import { recipeIdFromUrl, recipePath } from '../recipe-navigation.js';
import { testDatabase } from './helpers/database.js';

function setup(t, overrides = {}) {
  const { sqlite, DB } = testDatabase();
  t.after(() => sqlite.close());
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://recipeboy.bensonperry.com/');
    assert.deepEqual(options.headers, { Accept: 'text/html' });
    return new Response(readFileSync(new URL('../index.html', import.meta.url), 'utf8'), { headers: { 'Content-Type': 'text/html' } });
  });
  const recipe = {
    title: 'Sunday tomato soup', description: 'Roasted tomatoes with basil and cream.',
    yield: '4 servings', totalMinutes: 45, ingredients: [{ item: 'tomatoes' }, { item: 'basil' }],
    instructions: ['Roast, blend, and serve.'], imageUrl: 'https://example.com/soup.jpg', ...overrides,
  };
  const save = () => sqlite.prepare('UPDATE recipes SET title = ?, data_json = ? WHERE id = ?').run(recipe.title, JSON.stringify(recipe), 'soup');
  sqlite.prepare('INSERT INTO recipes (id, title, data_json, created_at) VALUES (?, ?, ?, ?)')
    .run('soup', recipe.title, JSON.stringify(recipe), '2026-09-14');
  const request = (path = '/recipe/soup', options = {}) => worker.fetch(new Request(`https://recipeboy.bensonperry.com${path}`, options), { DB });
  const addPhoto = (id, date, deleted = null) => sqlite.prepare('INSERT INTO recipe_photos (id, recipe_id, user_id, object_key, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, 'soup', 'friend', `soup/${id}.webp`, date, deleted);
  return { sqlite, recipe, save, request, addPhoto };
}

test('anonymous crawlers receive recipe metadata in a 200 HTML response without following a redirect', async (t) => {
  const { request } = setup(t);
  const response = await request('/recipe/soup?tracking=ignored', { headers: { 'User-Agent': 'facebookexternalhit/1.1' } });
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
  assert.match(html, /property="og:url" content="https:\/\/recipeboy\.bensonperry\.com\/recipe\/soup"/);
  assert.match(html, /rel="canonical" href="https:\/\/recipeboy\.bensonperry\.com\/recipe\/soup"/);
  assert.match(html, /property="og:image" content="https:\/\/example\.com\/soup\.jpg"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /id="recipe-dialog"/);
  assert.match(html, /<script type="module" src="app\.js\?v=/);
  assert.match(html, /http-equiv="Content-Security-Policy"/);
  assert.equal((html.match(/<base href="\/">/g) || []).length, 1);
  assert.ok(html.indexOf('<base href="/">') < html.indexOf('href="style.css'), 'The base must precede relative asset URLs');
  assert.equal((html.match(/property="og:title"/g) || []).length, 1);
  assert.equal((html.match(/<title>/g) || []).length, 1);
  assert.doesNotMatch(html, /http-equiv="refresh"|RECIPEBOY JOY|location\.replace/);
  const head = await request('/recipe/soup', { method: 'HEAD' });
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
  assert.doesNotMatch(html, /og:image|twitter:image/);
});

test('missing, malformed, and deleted links return 404 without exposing old recipe content', async (t) => {
  const { request, sqlite } = setup(t);
  sqlite.prepare('UPDATE recipes SET deleted_at = ?').run('2026-09-14');
  for (const path of ['/recipe/soup', '/recipe/missing', '/recipe/', '/recipe/%3Cscript%3E']) {
    const response = await request(path);
    assert.equal(response.status, 404);
    const html = await response.text();
    assert.match(html, /Recipe unavailable/);
    assert.doesNotMatch(html, /Sunday tomato soup|Roasted tomatoes|og:image|location\.replace/);
  }
});

test('recipe content cannot escape the metadata or add executable markup', async (t) => {
  const { request, recipe, save } = setup(t, {
    title: 'Soup </title><script>alert(1)</script> & "friends"',
    description: '"><img src=x onerror=alert(2)>', imageUrl: 'javascript:alert(3)',
  });
  const html = await (await request()).text();
  assert.match(html, /&lt;\/title&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;friends&quot;/);
  assert.match(html, /&quot;&gt;&lt;img src=x onerror=alert\(2\)&gt;/);
  assert.equal((html.match(/<script/g) || []).length, 1);
  assert.doesNotMatch(html.split('</head>')[0], /<img src=x|javascript:|og:image/);
  recipe.imageUrl = 'http://127.0.0.1/private.png';
  save();
  assert.doesNotMatch(await (await request()).text(), /og:image|private\.png/);
  recipe.imageUrl = 'https://user:password@example.com/private.png';
  save();
  assert.doesNotMatch(await (await request()).text(), /og:image|password/);
});

test('previous Worker share URLs redirect to the canonical recipe URL', async (t) => {
  const { request } = setup(t);
  for (const method of ['GET', 'HEAD']) {
    const response = await request('/share/soup?tracking=ignored', { method });
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('Location'), 'https://recipeboy.bensonperry.com/recipe/soup');
  }
});

test('clean paths and legacy hash links identify the same recipe without accepting invalid IDs', () => {
  assert.equal(recipePath('my-soup'), '/recipe/my-soup');
  for (const path of ['/recipe/my-soup', '/recipe/my-soup/', '/?auth=dev#recipe=my-soup']) {
    assert.equal(recipeIdFromUrl(`https://recipeboy.bensonperry.com${path}`), 'my-soup');
  }
  for (const path of ['/', '/recipe/a/b', '/recipe/%3Cscript%3E', '/#recipe=a&other=b']) {
    assert.equal(recipeIdFromUrl(`https://recipeboy.bensonperry.com${path}`), '');
  }
});

test('an unavailable app origin fails explicitly without returning a broken successful page', async (t) => {
  const { request } = setup(t);
  for (const status of [302, 503]) {
    t.mock.method(globalThis, 'fetch', async () => new Response('Unavailable', { status, headers: { Location: 'https://example.com/' } }));
    assert.equal((await request()).status, 502);
  }
});
