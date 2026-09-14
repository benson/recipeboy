import { formatDuration } from '../duration.js';
import { yieldLabel, timeIsEstimated } from '../recipe-metadata.js';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

function text(value, limit) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 1).trimEnd()}…` : normalized;
}

export function shareDescription(recipe) {
  if (text(recipe.description, 200)) return text(recipe.description, 200);
  const duration = formatDuration(recipe.totalMinutes || (Number(recipe.prepMinutes || 0) + Number(recipe.cookMinutes || 0)));
  const ingredients = (recipe.ingredients || []).map((ingredient) => typeof ingredient === 'string' ? ingredient : ingredient.item).filter(Boolean).slice(0, 5);
  return text([
    yieldLabel(recipe),
    duration && `${timeIsEstimated(recipe) ? '≈ ' : ''}${duration}`,
    ingredients.length ? `With ${ingredients.join(', ')}` : `${recipe.title} recipe`,
  ].filter(Boolean).join(' · '), 200);
}

export function recipeSite(request) {
  const url = new URL(request.url);
  return ['localhost', '127.0.0.1'].includes(url.hostname) ? 'http://127.0.0.1:4173' : 'https://recipeboy.bensonperry.com';
}

export function recipeShareResponse({ request, id, recipe, imageUrl = '', appHtml = '' }) {
  const site = recipeSite(request);
  const canonical = `${site}/recipe/${encodeURIComponent(id)}`;
  const title = recipe ? text(recipe.title, 160) : 'Recipe unavailable';
  const description = recipe ? shareDescription(recipe) : 'This recipe is no longer in the recipe box, or this link is incorrect.';
  const meta = (attribute, key, value) => `<meta ${attribute}="${key}" content="${escapeHtml(value)}">`;
  const metadata = `
  <title>${escapeHtml(title)} · Recipeboy</title>
  ${meta('name', 'description', description)}
  <link rel="canonical" href="${escapeHtml(canonical)}">
  ${meta('property', 'og:type', 'article')}
  ${meta('property', 'og:site_name', 'Recipeboy')}
  ${meta('property', 'og:title', title)}
  ${meta('property', 'og:description', description)}
  ${meta('property', 'og:url', canonical)}
  ${meta('name', 'twitter:card', imageUrl ? 'summary_large_image' : 'summary')}
  ${meta('name', 'twitter:title', title)}
  ${meta('name', 'twitter:description', description)}
  ${imageUrl ? [meta('property', 'og:image', imageUrl), meta('property', 'og:image:alt', title), meta('name', 'twitter:image', imageUrl), meta('name', 'twitter:image:alt', title)].join('\n  ') : ''}
  `;
  let html;
  if (recipe) {
    // Rewrite only our trusted GitHub Pages shell; recipe text is always escaped above.
    if (!/<head>[\s\S]*?<\/head>/i.test(appHtml)) throw new Error('Recipeboy app HTML is unavailable.');
    html = appHtml.replace(/<head>([\s\S]*?)<\/head>/i, (_, head) => `<head>\n  <base href="/">${head
      .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '')
      .replace(/<meta\b(?=[^>]*(?:name|property)="(?:description|og:[^"]+|twitter:[^"]+)")[^>]*>/gi, '')
      .replace(/<link\b(?=[^>]*rel="canonical")[^>]*>/gi, '')
      .replace(/<base\b[^>]*>/gi, '')}
  ${metadata}</head>`);
  } else {
    html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  ${metadata}
  <style>body{font:18px/1.5 system-ui,sans-serif;max-width:40rem;margin:10vh auto;padding:0 1.5rem;color:#25221d;background:#fffdf5}a{color:inherit}</style>
</head>
<body>
  <main>
    <p>Recipeboy</p>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(description)}</p>
    <p><a href="${site}/">Browse the recipe box</a></p>
  </main>
</body>
</html>`;
  }
  return new Response(request.method === 'HEAD' ? null : html, {
    status: recipe ? 200 : 404,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      // The app shell keeps its existing CSP meta tag for scripts, auth, and assets.
      'Content-Security-Policy': "frame-ancestors 'none'",
    },
  });
}
