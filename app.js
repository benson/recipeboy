const API = ['localhost', '127.0.0.1'].includes(location.hostname)
  ? 'http://127.0.0.1:8787'
  : 'https://recipeboy-api.bensonperry.workers.dev';

const state = { recipes: [], query: '', activeId: null };
const el = {
  form: document.getElementById('recipe-form'),
  input: document.getElementById('recipe-input'),
  status: document.getElementById('form-status'),
  grid: document.getElementById('recipe-grid'),
  empty: document.getElementById('empty-state'),
  count: document.getElementById('recipe-count'),
  search: document.getElementById('search'),
  dialog: document.getElementById('recipe-dialog'),
  dialogContent: document.getElementById('dialog-content'),
  toast: document.getElementById('toast'),
};

const esc = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

async function api(path, options = {}) {
  const response = await fetch(API + path, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json', ...(options.headers || {}) } : options.headers,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Something went sideways.');
  return data;
}

function minutesLabel(recipe) {
  const minutes = recipe.totalMinutes || ((recipe.prepMinutes || 0) + (recipe.cookMinutes || 0));
  if (!minutes) return '';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

function ingredientText(ingredient) {
  return [ingredient.amount, ingredient.unit, ingredient.item].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function shoppingList(recipe) {
  return recipe.ingredients.map((ingredient) => `☐ ${ingredientText(ingredient)}`).join('\n');
}

async function copyShoppingList(recipe) {
  const text = `${recipe.title}\n${shoppingList(recipe)}`;
  await navigator.clipboard.writeText(text);
  showToast('Shopping list copied!');
}

let toastTimer;
function showToast(message) {
  el.toast.textContent = message;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2200);
}

function visibleRecipes() {
  const query = state.query.trim().toLowerCase();
  if (!query) return state.recipes;
  return state.recipes.filter((recipe) => [
    recipe.title,
    recipe.description,
    recipe.sourceName,
    ...(recipe.tags || []),
    ...(recipe.ingredients || []).map((item) => item.item),
  ].join(' ').toLowerCase().includes(query));
}

function cardTemplate(recipe) {
  const time = minutesLabel(recipe);
  const source = recipe.sourceName || (recipe.sourceUrl ? 'From the web' : 'Friends’ recipe');
  return `<article class="recipe-card" data-id="${esc(recipe.id)}">
    <div class="card-color"></div>
    <div class="card-body" data-open="${esc(recipe.id)}" tabindex="0" role="button" aria-label="Open ${esc(recipe.title)}">
      <span class="source-label">${esc(source)}</span>
      <h3>${esc(recipe.title)}</h3>
      <p class="card-description">${esc(recipe.description || 'A recipe worth keeping.')}</p>
      <div class="card-meta">
        ${time ? `<span class="pill">◷ ${esc(time)}</span>` : ''}
        ${recipe.yield ? `<span class="pill">♨ ${esc(recipe.yield)}</span>` : ''}
        <span class="pill">${recipe.ingredients.length} ingredients</span>
      </div>
    </div>
    <div class="card-actions">
      <button data-copy="${esc(recipe.id)}">Copy list</button>
      <button data-made="${esc(recipe.id)}">I made this! · ${recipe.madeCount || 0}</button>
    </div>
  </article>`;
}

function render() {
  const recipes = visibleRecipes();
  el.grid.innerHTML = recipes.map(cardTemplate).join('');
  const total = state.recipes.length;
  el.count.textContent = total ? `${total} keeper${total === 1 ? '' : 's'} in the shared box` : 'No recipes in the box yet';
  el.empty.hidden = recipes.length > 0;
  if (!recipes.length && state.query) {
    el.empty.querySelector('h3').textContent = 'No bites found.';
    el.empty.querySelector('p').textContent = 'Try another ingredient or recipe name.';
  } else {
    el.empty.querySelector('h3').textContent = 'His recipe box is hungry.';
    el.empty.querySelector('p').textContent = 'Paste the first family favorite up above.';
  }
}

function detailTemplate(recipe) {
  const sourceUrl = safeUrl(recipe.sourceUrl);
  const ingredients = recipe.ingredients.map((ingredient) => `<li>${ingredient.amount ? `<strong>${esc([ingredient.amount, ingredient.unit].filter(Boolean).join(' '))}</strong> ` : ''}${esc(ingredient.item)}</li>`).join('');
  const steps = recipe.instructions.map((step) => `<li>${esc(step)}</li>`).join('');
  const time = minutesLabel(recipe);
  return `<div class="detail-hero">
      <span class="source-label">${esc(recipe.sourceName || 'Friends’ recipe')}</span>
      <h2>${esc(recipe.title)}</h2>
      ${recipe.description ? `<p>${esc(recipe.description)}</p>` : ''}
      <div class="detail-meta">
        ${time ? `<span class="pill">◷ ${esc(time)}</span>` : ''}
        ${recipe.yield ? `<span class="pill">♨ ${esc(recipe.yield)}</span>` : ''}
        ${(recipe.tags || []).slice(0, 4).map((tag) => `<span class="pill">${esc(tag)}</span>`).join('')}
      </div>
    </div>
    <div class="detail-actions">
      <button class="action-button" data-copy="${esc(recipe.id)}">Copy shopping list</button>
      <button class="action-button made" data-made="${esc(recipe.id)}">I made this! · ${recipe.madeCount || 0}</button>
      ${sourceUrl ? `<a class="action-button source-link" href="${esc(sourceUrl)}" target="_blank" rel="noopener">Original recipe ↗</a>` : ''}
    </div>
    <div class="recipe-columns">
      <section><h3>What you need</h3><ul class="ingredient-list">${ingredients || '<li>Ingredients weren’t listed.</li>'}</ul></section>
      <section><h3>What to do</h3><ol class="steps">${steps || '<li>Instructions weren’t listed.</li>'}</ol></section>
    </div>`;
}

function openRecipe(id) {
  const recipe = state.recipes.find((item) => item.id === id);
  if (!recipe) return;
  state.activeId = id;
  el.dialogContent.innerHTML = detailTemplate(recipe);
  el.dialog.showModal();
}

function refreshDialog() {
  if (!state.activeId || !el.dialog.open) return;
  const recipe = state.recipes.find((item) => item.id === state.activeId);
  if (recipe) el.dialogContent.innerHTML = detailTemplate(recipe);
}

async function markMade(id) {
  const recipe = state.recipes.find((item) => item.id === id);
  if (!recipe) return;
  try {
    const result = await api(`/recipes/${encodeURIComponent(id)}/made`, { method: 'POST' });
    recipe.madeCount = result.madeCount;
    render();
    refreshDialog();
    showToast(result.madeCount === 1 ? 'First cook! Legendary.' : `${result.madeCount} cooks and counting!`);
  } catch (error) { showToast(error.message); }
}

async function submitRecipe(event) {
  event.preventDefault();
  const input = el.input.value.trim();
  if (!input) return;
  const button = el.form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.querySelector('span').textContent = /^https?:\/\//i.test(input) ? 'Reading that page…' : 'Tidying your notes…';
  el.status.hidden = true;
  try {
    const result = await api('/recipes', { method: 'POST', body: JSON.stringify({ input }) });
    state.recipes.unshift(result.recipe);
    el.input.value = '';
    el.status.textContent = `Saved “${result.recipe.title}” to the shared box.`;
    el.status.className = 'form-status success';
    el.status.hidden = false;
    render();
    openRecipe(result.recipe.id);
  } catch (error) {
    el.status.textContent = error.message;
    el.status.className = 'form-status';
    el.status.hidden = false;
  } finally {
    button.disabled = false;
    button.querySelector('span').textContent = 'Normalize it!';
  }
}

async function handleAction(event) {
  const copyButton = event.target.closest('[data-copy]');
  if (copyButton) {
    const recipe = state.recipes.find((item) => item.id === copyButton.dataset.copy);
    if (recipe) await copyShoppingList(recipe);
    return;
  }
  const madeButton = event.target.closest('[data-made]');
  if (madeButton) return markMade(madeButton.dataset.made);
  const openTarget = event.target.closest('[data-open]');
  if (openTarget) openRecipe(openTarget.dataset.open);
}

el.form.addEventListener('submit', submitRecipe);
el.grid.addEventListener('click', handleAction);
el.grid.addEventListener('keydown', (event) => {
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-open]')) {
    event.preventDefault();
    openRecipe(event.target.dataset.open);
  }
});
el.dialog.addEventListener('click', handleAction);
document.getElementById('dialog-close').addEventListener('click', () => el.dialog.close());
el.dialog.addEventListener('click', (event) => { if (event.target === el.dialog) el.dialog.close(); });
el.search.addEventListener('input', () => { state.query = el.search.value; render(); });

try {
  const result = await api('/recipes');
  state.recipes = result.recipes || [];
  render();
} catch (error) {
  el.count.textContent = 'Couldn’t reach the shared box';
  el.empty.hidden = false;
  el.empty.querySelector('h3').textContent = 'Recipeboy is taking a snack break.';
  el.empty.querySelector('p').textContent = 'Try refreshing in a moment.';
}
