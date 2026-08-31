const MAX_INPUT = 50_000;
const MAX_PAGE = 2_000_000;

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors() } });
}

function cleanText(value, limit = 5000) {
  return String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function decodeHtml(value = '') {
  const entities = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
  return String(value)
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/&#x([\da-f]+);/gi, (_, number) => String.fromCodePoint(parseInt(number, 16)))
    .replace(/&([a-z]+);/gi, (whole, name) => entities[name.toLowerCase()] ?? whole);
}

function toArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function parseDuration(value) {
  if (typeof value === 'number') return Math.max(0, Math.round(value));
  const text = String(value || '').trim();
  const iso = text.match(/^P(?:([\d.]+)D)?(?:T(?:([\d.]+)H)?(?:([\d.]+)M)?)?$/i);
  if (iso) return Math.round((Number(iso[1] || 0) * 1440) + (Number(iso[2] || 0) * 60) + Number(iso[3] || 0));
  const hours = Number(text.match(/([\d.]+)\s*(?:hours?|hrs?)/i)?.[1] || 0);
  const minutes = Number(text.match(/([\d.]+)\s*(?:minutes?|mins?)/i)?.[1] || 0);
  return Math.round(hours * 60 + minutes) || 0;
}

const UNIT_PATTERN = '(?:cups?|c|tablespoons?|tbsp|teaspoons?|tsp|ounces?|oz|pounds?|lbs?|grams?|g|kilograms?|kg|milliliters?|ml|liters?|l|cloves?|cans?|packages?|pkg|pinch(?:es)?|dash(?:es)?|slices?|sprigs?|stalks?|heads?|bunch(?:es)?)';

function parseIngredient(value) {
  const original = cleanText(value, 300).replace(/^[•*\-–—]\s*/, '');
  const match = original.match(new RegExp(`^((?:\\d+[ \\t]+)?(?:\\d+\\/\\d+|[¼½¾⅓⅔⅛⅜⅝⅞]|\\d+(?:\\.\\d+)?)(?:\\s*(?:-|–|to)\\s*(?:\\d+\\/\\d+|[¼½¾⅓⅔⅛⅜⅝⅞]|\\d+(?:\\.\\d+)?))?)?\\s*(${UNIT_PATTERN}\\b)?\\.?\\s*(.*)$`, 'i'));
  if (!match) return { amount: '', unit: '', item: original };
  const amount = cleanText(match[1], 30);
  const unit = cleanText(match[2], 40);
  let item = cleanText(match[3], 250).replace(/^of\s+/i, '');
  if (!item && unit) { item = unit; return { amount, unit: '', item }; }
  return { amount, unit, item: item || original };
}

function instructionText(value) {
  if (typeof value === 'string') return [cleanText(value)];
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value.itemListElement)) return value.itemListElement.flatMap(instructionText);
  return [cleanText(value.text || value.name)].filter(Boolean);
}

function findRecipeNode(value) {
  if (!value) return null;
  if (Array.isArray(value)) {
    for (const item of value) { const found = findRecipeNode(item); if (found) return found; }
    return null;
  }
  if (typeof value !== 'object') return null;
  const types = toArray(value['@type']).map((type) => String(type).toLowerCase());
  if (types.includes('recipe')) return value;
  for (const key of ['@graph', 'mainEntity', 'itemListElement']) {
    const found = findRecipeNode(value[key]);
    if (found) return found;
  }
  return null;
}

function sourceName(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function normalizeRecipe(raw, sourceUrl = '') {
  const ingredients = toArray(raw.recipeIngredient || raw.ingredients)
    .map((item) => typeof item === 'string' ? item : item?.text || item?.name)
    .filter(Boolean)
    .map(parseIngredient)
    .filter((item) => item.item);
  const instructions = toArray(raw.recipeInstructions || raw.instructions).flatMap(instructionText).filter(Boolean);
  const image = toArray(raw.image)[0];
  const imageUrl = typeof image === 'string' ? image : image?.url || image?.contentUrl || '';
  const recipe = {
    title: cleanText(raw.name || raw.title || 'Untitled recipe', 160),
    description: cleanText(raw.description, 600),
    yield: cleanText(toArray(raw.recipeYield || raw.yield)[0], 80),
    prepMinutes: parseDuration(raw.prepTime || raw.prepMinutes),
    cookMinutes: parseDuration(raw.cookTime || raw.cookMinutes),
    totalMinutes: parseDuration(raw.totalTime || raw.totalMinutes),
    ingredients,
    instructions,
    tags: toArray(raw.keywords || raw.recipeCategory || raw.recipeCuisine)
      .flatMap((tag) => String(tag).split(','))
      .map((tag) => cleanText(tag, 40)).filter(Boolean).slice(0, 12),
    sourceUrl: sourceUrl || cleanText(raw.url, 1000),
    sourceName: sourceUrl ? sourceName(sourceUrl) : cleanText(raw.sourceName, 100),
    imageUrl: cleanText(imageUrl, 1000),
  };
  if (!recipe.totalMinutes) recipe.totalMinutes = recipe.prepMinutes + recipe.cookMinutes;
  return recipe;
}

function sectionName(line) {
  const normalized = line.toLowerCase().replace(/[:：]\s*$/, '').trim();
  if (/^(ingredients?|what you(?:'|’)ll need|you(?:'|’)ll need|shopping list)$/.test(normalized)) return 'ingredients';
  if (/^(instructions?|directions?|method|steps?|what to do)$/.test(normalized)) return 'instructions';
  if (/^(description|about|notes?)$/.test(normalized)) return 'description';
  if (/^(yield|serves?|servings?)$/.test(normalized)) return 'yield';
  if (/^(prep(?: time)?|cook(?: time)?|total(?: time)?)$/.test(normalized)) return normalized.startsWith('prep') ? 'prep' : normalized.startsWith('cook') ? 'cook' : 'total';
  if (/^(tags?|category|cuisine)$/.test(normalized)) return 'tags';
  return '';
}

function looksLikeIngredient(line) {
  return new RegExp(`^(?:[•*\\-–—]\\s*)?(?:\\d+[ \\t]+)?(?:\\d+\\/\\d+|[¼½¾⅓⅔⅛⅜⅝⅞]|\\d+(?:\\.\\d+)?)\\s*(?:${UNIT_PATTERN})?\\b`, 'i').test(line) || /^(?:salt|pepper|oil|water)\b/i.test(line);
}

function parsePlaintext(input) {
  const lines = String(input).replace(/\r/g, '').split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.length) throw new Error('Paste a recipe first.');
  let title = '';
  const buckets = { ingredients: [], instructions: [], description: [], yield: [], prep: [], cook: [], total: [], tags: [] };
  let section = '';
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index];
    const inlineHeading = line.match(/^([^:]{2,24}):\s*(.+)$/);
    const heading = sectionName(line) || (inlineHeading && sectionName(inlineHeading[1]));
    if (heading) {
      section = heading;
      if (inlineHeading && inlineHeading[2]) buckets[section].push(inlineHeading[2]);
      continue;
    }
    if (!title && !section && !looksLikeIngredient(line) && !/^\d+[.)]\s+/.test(line)) {
      title = line.replace(/^recipe\s*:\s*/i, '').slice(0, 160);
      continue;
    }
    if (section) buckets[section].push(line);
    else if (looksLikeIngredient(line)) buckets.ingredients.push(line);
    else if (/^\d+[.)]\s+/.test(line)) buckets.instructions.push(line.replace(/^\d+[.)]\s+/, ''));
    else buckets.description.push(line);
  }
  if (!buckets.ingredients.length && lines.length > 1) {
    const candidates = lines.slice(title ? 1 : 0);
    const firstInstruction = candidates.findIndex((line) => /^(?:mix|stir|heat|add|cook|bake|roast|serve|combine|place|pour|whisk|chop|slice)\b/i.test(line));
    if (firstInstruction > 0) {
      buckets.ingredients.push(...candidates.slice(0, firstInstruction));
      buckets.instructions.push(...candidates.slice(firstInstruction));
    }
  }
  const recipe = normalizeRecipe({
    name: title || 'Friends’ recipe',
    description: buckets.description.join(' '),
    recipeYield: buckets.yield[0] || '',
    prepTime: buckets.prep[0] || '',
    cookTime: buckets.cook[0] || '',
    totalTime: buckets.total[0] || '',
    keywords: buckets.tags,
    recipeIngredient: buckets.ingredients,
    recipeInstructions: buckets.instructions.map((line) => line.replace(/^\d+[.)]\s+/, '')),
  });
  if (!recipe.ingredients.length && !recipe.instructions.length) {
    throw new Error('I could not find ingredients or steps. Add “Ingredients” and “Instructions” headings and try again.');
  }
  return recipe;
}

function extractJsonLd(html) {
  const scripts = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json[^"']*["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const match of scripts) {
    const text = decodeHtml(match[1]).replace(/^\s*<!--|-->\s*$/g, '').trim();
    try {
      const found = findRecipeNode(JSON.parse(text));
      if (found) return found;
    } catch { /* keep looking through scripts */ }
  }
  return null;
}

function validatePublicUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error('That does not look like a complete recipe URL.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Recipe links must start with http:// or https://.');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host === '0.0.0.0' || host === '::1' || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    throw new Error('That URL points to a private network.');
  }
  return url;
}

async function recipeFromUrl(input) {
  const url = validatePublicUrl(input);
  const response = await fetch(url, { headers: { 'User-Agent': 'Recipeboy/1.0 (+https://bensonperry.com/recipeboy/)', Accept: 'text/html,application/xhtml+xml' }, redirect: 'follow', signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`That recipe page returned ${response.status}. Try pasting the recipe text instead.`);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('html')) throw new Error('That link is not an HTML recipe page. Try pasting the recipe text instead.');
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_PAGE) throw new Error('That recipe page is too large to read. Try pasting the recipe text instead.');
  const html = (await response.text()).slice(0, MAX_PAGE);
  const node = extractJsonLd(html);
  if (!node) throw new Error('I could not find a structured recipe on that page. Paste its ingredients and steps instead.');
  return normalizeRecipe(node, response.url || url.href);
}

function rowToRecipe(row) {
  const recipe = JSON.parse(row.data_json);
  return { id: row.id, ...recipe, madeCount: row.made_count, createdAt: row.created_at };
}

async function listRecipes(env) {
  const { results } = await env.DB.prepare('SELECT id, data_json, made_count, created_at FROM recipes ORDER BY created_at DESC LIMIT 500').all();
  return results.map(rowToRecipe);
}

async function createRecipe(request, env) {
  const body = await request.json().catch(() => ({}));
  const input = String(body.input || '').trim();
  if (!input) return json({ error: 'Paste a recipe link or some recipe text first.' }, 400);
  if (input.length > MAX_INPUT) return json({ error: 'That recipe is too long. Keep it under 50,000 characters.' }, 413);
  let recipe;
  try { recipe = /^https?:\/\//i.test(input) ? await recipeFromUrl(input) : parsePlaintext(input); }
  catch (error) { return json({ error: error.message || 'I could not normalize that recipe.' }, 422); }
  const id = crypto.randomUUID().slice(0, 12);
  const createdAt = new Date().toISOString();
  await env.DB.prepare('INSERT INTO recipes (id, title, source_url, source_name, data_json, made_count, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)')
    .bind(id, recipe.title, recipe.sourceUrl || null, recipe.sourceName || null, JSON.stringify(recipe), createdAt).run();
  return json({ recipe: { id, ...recipe, madeCount: 0, createdAt } }, 201);
}

async function markMade(id, env) {
  const row = await env.DB.prepare('UPDATE recipes SET made_count = made_count + 1 WHERE id = ? RETURNING made_count').bind(id).first();
  if (!row) return json({ error: 'Recipe not found.' }, 404);
  return json({ id, madeCount: row.made_count });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (request.method === 'GET' && path === '/') return json({ ok: true, service: 'recipeboy-api' });
      if (request.method === 'GET' && path === '/recipes') return json({ recipes: await listRecipes(env) });
      if (request.method === 'POST' && path === '/recipes') return createRecipe(request, env);
      const madeMatch = path.match(/^\/recipes\/([a-zA-Z0-9-]+)\/made$/);
      if (request.method === 'POST' && madeMatch) return markMade(madeMatch[1], env);
      return json({ error: 'Not found.' }, 404);
    } catch (error) {
      console.error(error);
      return json({ error: 'Recipeboy dropped the spoon. Try again in a moment.' }, 500);
    }
  },
};

export { extractJsonLd, findRecipeNode, normalizeRecipe, parseDuration, parseIngredient, parsePlaintext };
