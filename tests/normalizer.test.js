import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveRecipeTags, extractJsonLd, normalizeRecipe, parseDuration, parseIngredient, parsePlaintext, parseReaderMarkdown } from '../worker/worker.js';

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

test('derives useful protein, dish, and time tags', () => {
  const tags = deriveRecipeTags({
    title: 'Spicy chicken and rice', description: '', prepMinutes: 15, totalMinutes: 75,
    ingredients: [{ item: 'chicken thighs' }, { item: 'basmati rice' }, { item: 'harissa hot sauce' }],
    instructions: ['Cook everything in a skillet.'],
  });
  assert.deepEqual(tags, ['chicken', 'spicy', 'rice', '1+ hours', 'prep ≤ 15 min', 'one-pan']);
});
