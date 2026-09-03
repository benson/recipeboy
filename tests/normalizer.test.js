import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as signBytes } from 'node:crypto';
import worker, { deriveRecipeTags, extractJsonLd, fetchPublicUrl, findLinkedRecipeUrl, friendActivity, normalizeAvatar, normalizeRecipe, parseDuration, parseIngredient, parsePlaintext, parseReaderMarkdown, recipeFromAiPlaintextPayload, recipeFromAiSearchPayload, recipeFromPlaintextWithAi, recipeFromRedditPayload, redditPostId, renameRecipeList, validatePublicUrl, verifyClerkJwt } from '../worker/worker.js';

function signedClerkToken(privateKey, overrides = {}) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    sub: 'user_friend',
    iss: 'https://clerk.bensonperry.com',
    azp: 'https://bensonperry.com',
    nbf: now - 5,
    exp: now + 60,
    ...overrides,
  })}`;
  return `${unsigned}.${signBytes('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url')}`;
}

test('allows public recipe reads while keeping recipe writes signed in', async () => {
  const env = { DB: { prepare(sql) {
    const all = async (args = []) => {
      if (sql.includes('SELECT r.id, r.data_json')) return { results: [{
        id: 'recipe-1', data_json: JSON.stringify({ title: 'Soup', ingredients: [], instructions: [], tags: [] }),
        made_count: 0, created_at: '2026-01-01T00:00:00.000Z', can_edit: args[0] !== null ? 1 : 0,
        made_by_viewer: 0, rating_average: 0, rating_count: 0, viewer_rating: 0, viewer_review: '',
      }] };
      return { results: [] };
    };
    return { all, bind(...args) { return { all: () => all(args) }; } };
  } } };
  const response = await worker.fetch(new Request('https://recipeboy.test/recipes'), env);
  assert.equal(response.status, 200);
  const publicRecipes = (await response.json()).recipes;
  assert.equal(publicRecipes.length, 1);
  assert.equal(publicRecipes[0].canEdit, false);
  assert.equal(publicRecipes[0].madeByViewer, false);

  const writeResponse = await worker.fetch(new Request('https://recipeboy.test/recipes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: 'beans' }),
  }), env);
  assert.equal(writeResponse.status, 401);
  assert.match((await writeResponse.json()).error, /sign in/i);
});

test('normalizes avatar choices to the supported Recipeboy palette', () => {
  assert.deepEqual(normalizeAvatar({ background: 'mint', character: 'basil', flavor: 'umami' }), {
    background: 'mint', character: 'basil', flavor: 'umami',
  });
  assert.deepEqual(normalizeAvatar({ background: '<script>', accessory: 'wings', badge: 'x' }), {
    background: 'sunshine', character: 'classic', flavor: 'savory',
  });
  assert.deepEqual(normalizeAvatar({ background: 'tomato', accessory: 'chef', badge: 'fire' }), {
    background: 'tomato', character: 'chef', flavor: 'spicy',
  });
  assert.deepEqual(normalizeAvatar({ background: 'bubblegum', character: 'mushroom', flavor: 'citrusy' }), {
    background: 'bubblegum', character: 'mushroom', flavor: 'citrusy',
  });
});

test('builds a safe chronological activity feed from additions, cooks, and ratings', async () => {
  const rows = [
    { activity_type: 'rated', recipe_id: 'pie-1', recipe_title: 'Apple <b>Pie</b>', user_id: 'viewer', display_name: 'Benson', avatar_json: '{"background":"mint","character":"basil","flavor":"umami"}', occurred_at: '2026-09-01T12:00:00.000Z', rating: 5 },
    { activity_type: 'cooked', recipe_id: 'soup-1', recipe_title: 'Tomato Soup', user_id: 'friend', display_name: 'Rogromi', avatar_json: '{}', occurred_at: '2026-09-01T11:00:00.000Z', rating: null },
    { activity_type: 'added', recipe_id: 'rice-1', recipe_title: 'Garlic Rice', user_id: 'friend', display_name: 'Rogromi', avatar_json: '{}', occurred_at: '2026-09-01T10:00:00.000Z', rating: null },
  ];
  const env = { DB: { prepare(sql) {
    assert.match(sql, /UNION ALL/);
    return { all: async () => ({ results: rows }) };
  } } };
  const activity = await friendActivity(env, 'viewer');
  assert.deepEqual(activity.map((item) => item.type), ['rated', 'cooked', 'added']);
  assert.equal(activity[0].recipeTitle, 'Apple Pie');
  assert.equal(activity[0].rating, 5);
  assert.equal(activity[0].actor.isViewer, true);
  assert.equal(activity[1].actor.displayName, 'Rogromi');
  assert.equal(activity[1].actor.isViewer, false);
});

test('verifies Clerk JWT signatures, issuer, and authorized frontend', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const env = {
    CLERK_JWT_KEY: publicKey.export({ type: 'spki', format: 'pem' }),
    CLERK_ISSUER: 'https://clerk.bensonperry.com',
    CLERK_AUTHORIZED_PARTIES: 'https://bensonperry.com',
  };
  const request = new Request('https://recipeboy.test/recipes');
  const auth = await verifyClerkJwt(signedClerkToken(privateKey), env, request);
  assert.equal(auth.userId, 'user_friend');
  await assert.rejects(
    () => verifyClerkJwt(signedClerkToken(privateKey, { azp: 'https://attacker.example' }), env, request),
    /origin is not allowed/,
  );
});

test('CORS preflight allows bearer authorization', async () => {
  const response = await worker.fetch(new Request('https://recipeboy.test/recipes', { method: 'OPTIONS' }), {});
  assert.equal(response.status, 204);
  assert.match(response.headers.get('access-control-allow-headers'), /Authorization/);
});

test('renames an owned recipe list without losing its identity', async () => {
  const calls = [];
  const env = { DB: { prepare(sql) {
    return { bind(...args) {
      calls.push({ sql, args });
      return {
        async first() {
          if (sql.includes('id != ?')) return null;
          if (sql.startsWith('SELECT id FROM recipe_lists')) return { id: 'list-1' };
          return null;
        },
        async run() { return { success: true }; },
      };
    } };
  } } };
  const request = new Request('https://recipeboy.test/lists/list-1', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '  Dinner heroes  ' }),
  });
  const response = await renameRecipeList('list-1', request, env, 'user-friend');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.list.id, 'list-1');
  assert.equal(result.list.name, 'Dinner heroes');
  assert.ok(calls.some(({ sql, args }) => sql.startsWith('UPDATE recipe_lists') && args[0] === 'Dinner heroes' && args[2] === 'list-1'));
});

test('allows public recipe URLs and rejects local network targets', () => {
  assert.equal(validatePublicUrl('https://example.com/recipe#ingredients').href, 'https://example.com/recipe');
  for (const url of ['http://localhost/recipe', 'http://127.0.0.1/recipe', 'http://10.0.0.4/recipe', 'http://[::1]/recipe']) {
    assert.throws(() => validatePublicUrl(url), /private network/);
  }
});

test('revalidates redirect destinations before following them', async (context) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/private' } });
  };
  await assert.rejects(() => fetchPublicUrl('https://example.com/recipe'), /private network/);
  assert.equal(calls, 1);
});

test('rejects oversized API request bodies before normalization', async () => {
  const request = new Request('https://recipeboy.test/recipes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: 'x'.repeat(260_000) }),
  });
  const response = await worker.fetch(request, { RECIPEBOY_AUTH_DISABLED: '1' });
  assert.equal(response.status, 413);
  assert.match((await response.json()).error, /too large/i);
});

test('parses ISO and human durations', () => {
  assert.equal(parseDuration('PT1H20M'), 80);
  assert.equal(parseDuration('1 hour 15 minutes'), 75);
  assert.equal(parseDuration('3h 15m'), 195);
  assert.equal(parseDuration('3:15'), 195);
  assert.equal(parseDuration('an hour and 20 min'), 80);
  assert.equal(parseDuration('half an hour'), 30);
});

test('splits common ingredient amounts and units', () => {
  assert.deepEqual(parseIngredient('1 1/2 cups all-purpose flour'), { amount: '1 1/2', unit: 'cups', item: 'all-purpose flour' });
  assert.deepEqual(parseIngredient('2 cans black beans'), { amount: '2', unit: 'cans', item: 'black beans' });
  assert.deepEqual(parseIngredient('1 large onion, diced'), { amount: '1', unit: '', item: 'large onion, diced' });
  assert.deepEqual(parseIngredient('All-purpose flour: 1 1/3 cups'), { amount: '1 1/3', unit: 'cups', item: 'All-purpose flour' });
  assert.deepEqual(parseIngredient('Fresh pumpkin puree: 2 cups (Casper preferred)'), { amount: '2', unit: 'cups', item: 'Fresh pumpkin puree (Casper preferred)' });
  assert.deepEqual(parseIngredient('2 each eggs'), { amount: '2', unit: '', item: 'eggs' });
  assert.deepEqual(parseIngredient('salt to taste'), { amount: '', unit: '', item: 'salt to taste' });
});

test('normalizes schema.org Recipe JSON-LD', () => {
  const recipe = normalizeRecipe({
    '@type': 'Recipe', name: 'Fast Beans', prepTime: 'PT10M', cookTime: 'PT30M', recipeYield: '4 bowls',
    recipeIngredient: ['2 cans black beans', '1 onion'],
    recipeInstructions: [{ '@type': 'HowToStep', text: 'Cook everything.' }],
  }, 'https://example.com/beans');
  assert.equal(recipe.title, 'Fast Beans');
  assert.equal(recipe.totalMinutes, 40);
  assert.equal(recipe.ingredients[0].amount, '2');
  assert.equal(recipe.instructions[0], 'Cook everything.');
  assert.equal(recipe.sourceName, 'example.com');
});

test('extracts Recipe from an @graph JSON-LD script', () => {
  const html = `<script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":"Recipe","name":"Toast","recipeIngredient":["1 slice bread"],"recipeInstructions":["Toast it."]}]}</script>`;
  assert.equal(extractJsonLd(html).name, 'Toast');
});

test('normalizes plaintext with labeled sections', () => {
  const recipe = parsePlaintext(`Kim's Weeknight Chili
Serves: 6
Prep time: 10 minutes
Ingredients:
2 cans black beans
1 large onion, diced
1 tbsp cumin
Instructions:
1. Chop the onion.
2. Add everything to a pot.
3. Simmer for 30 minutes.`);
  assert.equal(recipe.title, "Kim's Weeknight Chili");
  assert.equal(recipe.yield, '6 servings');
  assert.equal(recipe.prepMinutes, 10);
  assert.equal(recipe.ingredients.length, 3);
  assert.equal(recipe.instructions.length, 3);
});

test('ignores equipment and normalizes ingredient-first quantities', () => {
  const recipe = parsePlaintext(`Heirloom Pumpkin Pie
Equipment Needed
Rolling pin
9-inch pie plate
Ingredients
All-purpose flour: 1 1/3 cups
Fresh pumpkin puree: 2 cups (Casper preferred)
Large eggs: 2
Instructions
Mix the filling.
Bake until set.`);
  assert.equal(recipe.title, 'Heirloom Pumpkin Pie');
  assert.equal(recipe.description, '');
  assert.equal(recipe.ingredients.length, 3);
  assert.deepEqual(recipe.ingredients[0], { amount: '1 1/3', unit: 'cups', item: 'All-purpose flour' });
  assert.deepEqual(recipe.ingredients[1], { amount: '2', unit: 'cups', item: 'Fresh pumpkin puree (Casper preferred)' });
  assert.equal(recipe.instructions.length, 2);
});

test('normalizes conversational Reddit recipe headings and step labels', () => {
  const recipe = parsePlaintext(`Slow Cooker Bowls
Makes 12 servings

Ingredients I use…
For the Slow Cooker:
184 commentssharesavereportcrosspost
0 :28
4 lbs lean top sirloin
3 cups beef broth
For Garnish:
12 slices provolone

How I make it…
Phase 1: Slow Cooker Setup
Step 1: Place the beef in the slow cooker.
Step 2: Add the broth and cook on low.`);
  assert.equal(recipe.ingredients.length, 3);
  assert.equal(recipe.ingredients[0].item, 'lean top sirloin');
  assert.equal(recipe.instructions.length, 2);
  assert.equal(recipe.instructions[0], 'Place the beef in the slow cooker.');
});

test('normalizes markdown returned by the blocked-site reader', () => {
  const recipe = parseReaderMarkdown(`A fast, deeply savory dinner for hungry friends.

Prep Time:
15 mins

Cook Time:
40 mins

Total Time:
1 hr 10 mins

Yield:
Serves 4

## Ingredients

For the chicken:

* 2 pounds chicken thighs
* 1 tablespoon olive oil

## Directions

1. Marinate the chicken.

Serious Eats / Example Person

2. Cook until browned and serve.

## Notes

Eat immediately.`, 'https://example.com/dinner', 'Chicken and Rice');

  assert.equal(recipe.title, 'Chicken and Rice');
  assert.equal(recipe.description, 'A fast, deeply savory dinner for hungry friends.');
  assert.equal(recipe.totalMinutes, 70);
  assert.equal(recipe.ingredients.length, 2);
  assert.equal(recipe.instructions.length, 2);
  assert.equal(recipe.instructions[0], 'Marinate the chicken.');
});

test('normalizes preparation headings and strips reader checkbox controls', () => {
  const recipe = parseReaderMarkdown(`## Ingredients

- [x] Deselect All
- [x] 2 cups flour
- [x] 1 teaspoon salt

## Preparation

1. Mix the ingredients.
2. Bake until golden.`, 'https://example.com/cookies', 'Cookies');
  assert.equal(recipe.ingredients.length, 2);
  assert.equal(recipe.ingredients[0].item, 'flour');
  assert.equal(recipe.instructions.length, 2);
});

test('derives useful protein, dish, and time tags', () => {
  const tags = deriveRecipeTags({
    title: 'Spicy chicken and rice', description: '', prepMinutes: 15, totalMinutes: 75,
    ingredients: [{ item: 'chicken thighs' }, { item: 'basmati rice' }, { item: 'harissa hot sauce' }],
    instructions: ['Cook everything in a skillet.'],
  });
  assert.deepEqual(tags, ['chicken', 'spicy', 'rice', '1+ hours', 'prep ≤ 15 min', 'one-pan']);
});

test('finds a same-site recipe linked from a cooking article', () => {
  const article = 'Read the full [Apple Bear Claws](https://cooking.nytimes.com/recipes/787586090-apple-bear-claws) recipe.';
  assert.equal(
    findLinkedRecipeUrl(article, 'https://cooking.nytimes.com/article/time-to-learn-your-abcs-apple-bear-claws'),
    'https://cooking.nytimes.com/recipes/787586090-apple-bear-claws',
  );
  assert.equal(findLinkedRecipeUrl('https://example.com/recipes/not-this-one', 'https://cooking.nytimes.com/article/example'), '');
});

test('recognizes regular and short Reddit post links', () => {
  assert.equal(redditPostId(new URL('https://www.reddit.com/r/MealPrepSunday/comments/1w236mr/example/')), '1w236mr');
  assert.equal(redditPostId(new URL('https://redd.it/1w236mr')), '1w236mr');
  assert.equal(redditPostId(new URL('https://example.com/comments/1w236mr')), '');
});

test('normalizes a recipe from an OAuth Reddit post payload', () => {
  const payload = [
    { data: { children: [{ data: {
      title: 'Slow Cooker Philly Cheesesteak Rice Bowls',
      permalink: '/r/MealPrepSunday/comments/1w236mr/example/',
      selftext: `A set-and-forget lunch.\n\n**Ingredients:**\n- 4 lbs lean top sirloin\n- 4 bell peppers, sliced\n- 3 cups beef broth\n\n**Instructions:**\n1. Place the beef and vegetables in a slow cooker.\n2. Cook on low for 6 hours.\n3. Slice the beef and serve over rice.`,
      preview: { images: [{ source: { url: 'https://preview.redd.it/example.jpg?width=1080&amp;format=pjpg' } }] },
    } }] } },
    { data: { children: [] } },
  ];
  const recipe = recipeFromRedditPayload(payload, 'https://www.reddit.com/comments/1w236mr');
  assert.equal(recipe.title, 'Slow Cooker Philly Cheesesteak Rice Bowls');
  assert.equal(recipe.ingredients.length, 3);
  assert.equal(recipe.instructions.length, 3);
  assert.equal(recipe.sourceName, 'reddit.com');
  assert.equal(recipe.sourceUrl, 'https://www.reddit.com/r/MealPrepSunday/comments/1w236mr/example/');
  assert.match(recipe.imageUrl, /&format=pjpg$/);
});

test('normalizes a structured recipe returned by indexed AI search', () => {
  const payload = { output: [{ content: [{ type: 'output_text', text: JSON.stringify({
    title: 'Indexed Chili', description: 'A Reddit favorite.', yield: '6 bowls', prepMinutes: 10,
    cookMinutes: 40, totalMinutes: 50, ingredients: ['2 cans black beans', '1 onion'],
    instructions: ['Chop the onion.', 'Simmer everything.'], tags: ['meal prep'],
  }) }] }] };
  const recipe = recipeFromAiSearchPayload(payload, 'https://www.reddit.com/comments/example');
  assert.equal(recipe.title, 'Indexed Chili');
  assert.equal(recipe.ingredients[0].amount, '2');
  assert.equal(recipe.instructions.length, 2);
  assert.equal(recipe.sourceName, 'reddit.com');
  assert.equal(recipe.importMethod, 'ai-web-search');
});

test('normalizes messy plaintext returned through the AI recipe schema', () => {
  const recipe = recipeFromAiPlaintextPayload({
    output_text: JSON.stringify({
      title: 'Heirloom Pumpkin Pie', description: 'A from-scratch pumpkin pie.', yield: '1 pie',
      prepMinutes: 0, cookMinutes: 0, totalMinutes: 0,
      ingredients: ['1 1/3 cups all-purpose flour', '2 cups pumpkin purée'],
      instructions: ['Make the crust.', 'Mix the filling and bake.'],
      tags: ['dessert'],
    }),
  });
  assert.equal(recipe.title, 'Heirloom Pumpkin Pie');
  assert.equal(recipe.ingredients[0].item, 'all-purpose flour');
  assert.equal(recipe.importMethod, 'ai-plaintext');
});

test('falls back to the deterministic plaintext parser when AI cleanup fails', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response('{}', { status: 503 });
  const recipe = await recipeFromPlaintextWithAi(`Simple Beans
Ingredients
2 cans black beans
Instructions
Simmer until hot.`, { OPENAI_API_KEY: 'test-key' });
  assert.equal(recipe.title, 'Simple Beans');
  assert.equal(recipe.ingredients[0].item, 'black beans');
  assert.equal(recipe.instructions[0], 'Simmer until hot.');
});
