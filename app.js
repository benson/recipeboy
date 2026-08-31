const API = ['localhost', '127.0.0.1'].includes(location.hostname)
  ? 'http://127.0.0.1:8787'
  : 'https://recipeboy-api.bensonperry.workers.dev';

const state = { recipes: [], query: '', tag: '', sort: 'newest', activeId: null, confirmDeleteId: null };
const el = {
  form: document.getElementById('recipe-form'),
  input: document.getElementById('recipe-input'),
  status: document.getElementById('form-status'),
  grid: document.getElementById('recipe-grid'),
  empty: document.getElementById('empty-state'),
  count: document.getElementById('recipe-count'),
  search: document.getElementById('search'),
  sort: document.getElementById('sort'),
  tagFilters: document.getElementById('tag-filters'),
  dialog: document.getElementById('recipe-dialog'),
  dialogContent: document.getElementById('dialog-content'),
  toast: document.getElementById('toast'),
  bookmarklet: document.getElementById('recipeboy-bookmarklet'),
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
  if (!response.ok) {
    const error = new Error(data.error || 'Something went sideways.');
    Object.assign(error, data);
    throw error;
  }
  return data;
}

async function normalizeInput(input, button, extra = {}) {
  try {
    return await api('/recipes', { method: 'POST', body: JSON.stringify({ input, ...extra }) });
  } catch (error) {
    if (error.code !== 'reader_fallback_required' || !error.readerUrl) throw error;
    button.querySelector('span').textContent = 'Trying the backup reader…';
    const response = await fetch(error.readerUrl, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`The backup reader returned ${response.status}. Try pasting the recipe text instead.`);
    const payload = await response.json();
    const readerMarkdown = payload?.data?.content || '';
    if (!readerMarkdown) throw new Error('The backup reader could not find the recipe. Try pasting its text instead.');
    return api('/recipes', {
      method: 'POST',
      body: JSON.stringify({ input, readerMarkdown, readerTitle: payload?.data?.title || '' }),
    });
  }
}

const bookmarkletSource = `(()=>{const tidy=s=>String(s||'').replace(/\\n{3,}/g,'\\n\\n').trim();const title=tidy(document.title.replace(/\\s*[-|:]\\s*Reddit.*$/i,''));const selected=tidy(String(getSelection()));const nodes=[...document.querySelectorAll('shreddit-post,[data-testid="post-container"],article,.usertext-body,.entry')];const score=e=>{const t=tidy(e.innerText);return (/ingredients?|directions?|instructions?|method/i.test(t)?100000:0)+Math.min(t.length,50000)};nodes.sort((a,b)=>score(b)-score(a));const pageText=selected||tidy(nodes[0]?.innerText)||tidy(document.querySelector('main')?.innerText)||tidy(document.body.innerText);if(pageText.length<40){alert('Recipeboy could not find enough recipe text on this page. Select the recipe text and try again.');return}const payload=encodeURIComponent(JSON.stringify({text:(title+'\\n'+pageText).slice(0,48000),sourceUrl:location.href,sourceTitle:title}));open('https://bensonperry.com/recipeboy/#clip='+payload,'_blank','noopener')})()`;
el.bookmarklet.setAttribute('href', `javascript:${bookmarkletSource}`);
el.bookmarklet.addEventListener('click', (event) => {
  event.preventDefault();
  showToast('Drag this button to your bookmarks bar!');
});

function bookmarkletPayload() {
  if (!location.hash.startsWith('#clip=')) return null;
  try {
    const payload = JSON.parse(decodeURIComponent(location.hash.slice(6)));
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    return payload;
  } catch {
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    return null;
  }
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
function showToast(message, action = null) {
  el.toast.replaceChildren(document.createTextNode(message));
  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action.label;
    button.addEventListener('click', async () => {
      button.disabled = true;
      await action.run();
    }, { once: true });
    el.toast.append(button);
  }
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), action ? 15_000 : 2200);
}

function visibleRecipes() {
  const query = state.query.trim().toLowerCase();
  const filtered = state.recipes.filter((recipe) => (!state.tag || (recipe.tags || []).includes(state.tag)) && (!query || [
    recipe.title,
    recipe.description,
    recipe.sourceName,
    ...(recipe.tags || []),
    ...(recipe.ingredients || []).map((item) => item.item),
  ].join(' ').toLowerCase().includes(query)));
  return filtered.sort((a, b) => {
    if (state.sort === 'most-made') return (b.madeCount || 0) - (a.madeCount || 0) || String(b.createdAt).localeCompare(String(a.createdAt));
    if (state.sort === 'quickest') return (a.totalMinutes || Number.MAX_SAFE_INTEGER) - (b.totalMinutes || Number.MAX_SAFE_INTEGER);
    if (state.sort === 'a-z') return a.title.localeCompare(b.title);
    return String(b.createdAt).localeCompare(String(a.createdAt));
  });
}

function renderTagFilters() {
  const counts = new Map();
  for (const recipe of state.recipes) {
    for (const tag of recipe.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  const tags = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const commonTags = new Set(tags.filter(([, count]) => count > 1).slice(0, 6).map(([tag]) => tag));
  if (state.tag) commonTags.add(state.tag);
  el.tagFilters.hidden = !tags.length;
  el.tagFilters.innerHTML = `<button class="tag-filter ${state.tag ? '' : 'active'}" data-tag=""><span class="tag-name">All</span> <span class="tag-count">${state.recipes.length}</span></button>${tags.map(([tag, count]) =>
    `<button class="tag-filter ${commonTags.has(tag) ? '' : 'tag-filter-overflow'} ${state.tag === tag ? 'active' : ''}" data-tag="${esc(tag)}"><span class="tag-name">${esc(tag)}</span> <span class="tag-count">${count}</span></button>`
  ).join('')}`;
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
      ${(recipe.tags || []).length ? `<div class="card-tags">${recipe.tags.slice(0, 3).map((tag) => `<span>${esc(tag)}</span>`).join('')}</div>` : ''}
    </div>
    <div class="card-actions">
      <button data-copy="${esc(recipe.id)}">Copy list</button>
      <button data-made="${esc(recipe.id)}">I made this! · ${recipe.madeCount || 0}</button>
    </div>
  </article>`;
}

function render() {
  const recipes = visibleRecipes();
  renderTagFilters();
  el.grid.innerHTML = recipes.map(cardTemplate).join('');
  const total = state.recipes.length;
  el.count.textContent = total ? `${total} keeper${total === 1 ? '' : 's'} in the shared box` : 'No recipes in the box yet';
  el.empty.hidden = recipes.length > 0;
  if (!recipes.length && (state.query || state.tag)) {
    el.empty.querySelector('h3').textContent = 'No bites found.';
    el.empty.querySelector('p').textContent = 'Try another ingredient, name, or tag.';
  } else {
    el.empty.querySelector('h3').textContent = 'His recipe box is hungry.';
    el.empty.querySelector('p').textContent = 'Paste the first family favorite up above.';
  }
}

function detailTemplate(recipe) {
  const sourceUrl = safeUrl(recipe.sourceUrl);
  const ingredients = recipe.ingredients.map((ingredient) => {
    const quantity = [ingredient.amount, ingredient.unit].filter(Boolean).join(' ');
    return `<li><strong class="ingredient-name">${esc(ingredient.item)}</strong>${quantity ? `<span class="ingredient-quantity">${esc(quantity)}</span>` : ''}</li>`;
  }).join('');
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
      <button class="action-button delete ${state.confirmDeleteId === recipe.id ? 'confirm' : ''}" data-delete="${esc(recipe.id)}">${state.confirmDeleteId === recipe.id ? 'Tap again to delete' : 'Delete recipe'}</button>
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
  state.confirmDeleteId = null;
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

async function deleteRecipe(id) {
  const recipe = state.recipes.find((item) => item.id === id);
  if (!recipe) return;
  if (state.confirmDeleteId !== id) {
    state.confirmDeleteId = id;
    refreshDialog();
    return;
  }

  try {
    await api(`/recipes/${encodeURIComponent(id)}`, { method: 'DELETE' });
    state.recipes = state.recipes.filter((item) => item.id !== id);
    state.confirmDeleteId = null;
    state.activeId = null;
    el.dialog.close();
    render();
    showToast(`Deleted “${recipe.title}”.`, {
      label: 'Undo',
      run: () => restoreRecipe(recipe),
    });
  } catch (error) { showToast(error.message); }
}

async function restoreRecipe(deletedRecipe) {
  try {
    const result = await api(`/recipes/${encodeURIComponent(deletedRecipe.id)}/restore`, { method: 'POST' });
    state.recipes.push(result.recipe);
    render();
    showToast(`Restored “${result.recipe.title}”.`);
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
    const result = await normalizeInput(input, button);
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
  const deleteButton = event.target.closest('[data-delete]');
  if (deleteButton) return deleteRecipe(deleteButton.dataset.delete);
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
el.dialog.addEventListener('close', () => {
  state.activeId = null;
  state.confirmDeleteId = null;
});
el.search.addEventListener('input', () => { state.query = el.search.value; render(); });
el.sort.addEventListener('change', () => { state.sort = el.sort.value; render(); });
el.tagFilters.addEventListener('click', (event) => {
  const button = event.target.closest('[data-tag]');
  if (!button) return;
  state.tag = button.dataset.tag;
  render();
});

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

const clippedRecipe = bookmarkletPayload();
if (clippedRecipe?.text) {
  const button = el.form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.querySelector('span').textContent = 'Saving from your browser…';
  try {
    const result = await normalizeInput(String(clippedRecipe.text), button, {
      sourceUrl: clippedRecipe.sourceUrl || '',
      sourceTitle: clippedRecipe.sourceTitle || '',
    });
    state.recipes.unshift(result.recipe);
    render();
    el.status.textContent = `Saved “${result.recipe.title}” from your browser.`;
    el.status.className = 'form-status success';
    el.status.hidden = false;
    openRecipe(result.recipe.id);
  } catch (error) {
    el.input.value = String(clippedRecipe.text).slice(0, 50_000);
    el.status.textContent = `${error.message} The captured text is in the box so you can tidy it and try again.`;
    el.status.className = 'form-status';
    el.status.hidden = false;
  } finally {
    button.disabled = false;
    button.querySelector('span').textContent = 'Normalize it!';
  }
}
