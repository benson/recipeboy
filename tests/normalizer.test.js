import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveRecipeTags, extractJsonLd, findLinkedRecipeUrl, normalizeRecipe, parseDuration, parseIngredient, parsePlaintext, parseReaderMarkdown, recipeFromAiSearchPayload, recipeFromRedditPayload, redditPostId } from '../worker/worker.js';

test('parses ISO and human durations', () => {
  assert.equal(parseDuration('PT1H20M'), 80);
  assert.equal(parseDuration('1 hour 15 minutes'), 75);
});

test('splits common ingredient amounts and units', () => {
  assert.deepEqual(parseIngredient('1 1/2 cups all-purpose flour'), { amount: '1 1/2', unit: 'cups', item: 'all-purpose flour' });
  assert.deepEqual(parseIngredient('2 cans black beans'), { amount: '2', unit: 'cans', item: 'black beans' });
  assert.deepEqual(parseIngredient('1 large onion, diced'), { amount: '1', unit: '', item: 'large onion, diced' });
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
  assert.equal(recipe.yield, '6');
  assert.equal(recipe.prepMinutes, 10);
  assert.equal(recipe.ingredients.length, 3);
  assert.equal(recipe.instructions.length, 3);
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
