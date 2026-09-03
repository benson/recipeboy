import { initAuth } from './auth.js?v=2';
import { normalizeYield, yieldLabel, timeIsEstimated } from './recipe-metadata.js?v=1';
import { formatDuration, parseDuration } from './duration.js?v=1';

const API = ['localhost', '127.0.0.1'].includes(location.hostname)
  ? 'http://127.0.0.1:8791'
  : 'https://recipeboy-api.bensonperry.workers.dev';

const state = { recipes: [], lists: [], profile: null, stats: null, activity: null, isSignedIn: false, query: '', tag: '', listId: '', sort: 'newest', activeId: null, activeScale: 1, listRecipeId: null, listEditId: null, confirmDeleteListId: null, confirmDeleteId: null };
const el = {
  toolbar: document.getElementById('site-toolbar'),
  hero: document.getElementById('page-top'),
  heroAddSlot: document.getElementById('hero-add-slot'),
  toolbarAddSlot: document.getElementById('toolbar-add-slot'),
  addButton: document.getElementById('add-recipe-button'),
  addDialog: document.getElementById('add-recipe-dialog'),
  form: document.getElementById('recipe-form'),
  input: document.getElementById('recipe-input'),
  status: document.getElementById('form-status'),
  grid: document.getElementById('recipe-grid'),
  empty: document.getElementById('empty-state'),
  count: document.getElementById('recipe-count'),
  search: document.getElementById('search'),
  sort: document.getElementById('sort'),
  listFilter: document.getElementById('list-filter'),
  tagFilters: document.getElementById('tag-filters'),
  dialog: document.getElementById('recipe-dialog'),
  dialogContent: document.getElementById('dialog-content'),
  profileDialog: document.getElementById('profile-dialog'),
  profileContent: document.getElementById('profile-content'),
  listDialog: document.getElementById('list-dialog'),
  listContent: document.getElementById('list-content'),
  editDialog: document.getElementById('edit-dialog'),
  editContent: document.getElementById('edit-content'),
  toast: document.getElementById('toast'),
  bookmarkletDock: document.getElementById('bookmarklet-dock'),
  bookmarkletDismiss: document.getElementById('bookmarklet-dismiss'),
  bookmarklet: document.getElementById('recipeboy-bookmarklet'),
  appMain: document.getElementById('app-main'),
  authGate: document.getElementById('auth-gate'),
  authMessage: document.getElementById('auth-message'),
  authControls: document.getElementById('auth-controls'),
  publicControls: document.getElementById('public-controls'),
  publicSignIn: document.getElementById('public-sign-in-button'),
  signIn: document.getElementById('sign-in-button'),
  account: document.getElementById('account-button'),
  accountAvatar: document.getElementById('account-avatar'),
  accountLabel: document.getElementById('account-label'),
  floatingRecipeboy: document.getElementById('floating-recipeboy'),
  statsButton: document.getElementById('stats-button'),
  statsDialog: document.getElementById('stats-dialog'),
  statsContent: document.getElementById('stats-content'),
  feedButton: document.getElementById('feed-button'),
  feedDialog: document.getElementById('feed-dialog'),
  feedContent: document.getElementById('feed-content'),
};

let authClient = null;
let pendingAuthUser;
let loadedUserId = '';
let addAfterSignIn = false;
let submittingRecipe = false;

// Keep one real Add button and dock it only after the hero has left the viewport.
let headerFrame = 0;
function updateHeader() {
  headerFrame = 0;
  const docked = el.hero.getBoundingClientRect().bottom <= el.toolbar.getBoundingClientRect().bottom + 16;
  if (el.toolbar.classList.contains('is-docked') === docked) return;
  const hadFocus = document.activeElement === el.addButton;
  el.toolbar.classList.toggle('is-docked', docked);
  (docked ? el.toolbarAddSlot : el.heroAddSlot).append(el.addButton);
  const brand = el.toolbar.querySelector('.toolbar-brand');
  brand.tabIndex = docked ? 0 : -1;
  brand.setAttribute('aria-hidden', String(!docked));
  if (hadFocus) el.addButton.focus({ preventScroll: true });
}
function scheduleHeaderUpdate() {
  if (!headerFrame) headerFrame = requestAnimationFrame(updateHeader);
}
window.addEventListener('scroll', scheduleHeaderUpdate, { passive: true });
window.addEventListener('resize', scheduleHeaderUpdate);
window.addEventListener('pageshow', scheduleHeaderUpdate);
updateHeader();

async function openAddRecipe() {
  if (!state.isSignedIn) {
    addAfterSignIn = true;
    try { await authClient?.signIn(); }
    catch (error) { addAfterSignIn = false; showToast(error.message); }
    return;
  }
  if (!el.addDialog.open) el.addDialog.showModal();
  el.input.focus({ preventScroll: true });
}

function setRecipeSubmitting(value) {
  submittingRecipe = value;
  el.form.setAttribute('aria-busy', String(value));
  el.input.readOnly = value;
  const button = el.form.querySelector('button[type="submit"]');
  button.disabled = value;
  if (!value) button.querySelector('span').textContent = state.isSignedIn ? 'Feed him!' : 'Sign in to add';
}

el.addButton.addEventListener('click', () => { void openAddRecipe(); });
document.getElementById('add-recipe-close').addEventListener('click', () => el.addDialog.close());
el.addDialog.addEventListener('click', (event) => { if (event.target === el.addDialog) el.addDialog.close(); });
el.toolbar.querySelector('.toolbar-brand').addEventListener('click', (event) => {
  event.preventDefault();
  window.scrollTo({ top: 0, behavior: 'instant' });
});

const esc = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

const SKELETON_CARD = '<article class="recipe-card recipe-card-skeleton" aria-hidden="true"><div class="card-color"></div><div class="card-body"><i class="skeleton-line skeleton-source"></i><i class="skeleton-line skeleton-title"></i><i class="skeleton-line skeleton-copy"></i><i class="skeleton-line skeleton-copy short"></i><div class="skeleton-pills"><i></i><i></i><i></i></div></div><div class="skeleton-actions"><i></i><i></i><i></i></div></article>';

function prepareAppLoading() {
  el.appMain.classList.add('app-loading');
  el.appMain.setAttribute('aria-busy', 'true');
  el.grid.classList.remove('recipe-grid-hydrating');
  el.grid.innerHTML = SKELETON_CARD.repeat(3);
  el.tagFilters.innerHTML = '';
  el.count.textContent = 'Opening the shared box…';
  el.empty.hidden = true;
}

function finishAppLoading() {
  el.appMain.classList.remove('app-loading');
  el.appMain.setAttribute('aria-busy', 'false');
}

const AVATAR_DEFAULT = { background: 'sunshine', character: 'classic', flavor: 'savory' };
const AVATAR_CHARACTERS = {
  classic: { label: 'Garlic original', image: 'assets/recipeboy-mascot-flat.png' },
  chef: { label: 'Whisk chef', image: 'assets/avatars/character-chef.png' },
  shallot: { label: 'Fork shallot', image: 'assets/avatars/character-shallot.png' },
  ginger: { label: 'Ginger sticks', image: 'assets/avatars/character-ginger.png' },
  scallion: { label: 'Tong scallion', image: 'assets/avatars/character-scallion.png' },
  chili: { label: 'Spatula chili', image: 'assets/avatars/character-chili.png' },
  carrot: { label: 'Peeler carrot', image: 'assets/avatars/character-carrot.png' },
  basil: { label: 'Shears basil', image: 'assets/avatars/character-basil.png' },
  lemon: { label: 'Zester lemon', image: 'assets/avatars/character-lemon.png' },
  tomato: { label: 'Spoon tomato', image: 'assets/avatars/character-tomato.png' },
  mushroom: { label: 'Knife mushroom', image: 'assets/avatars/character-mushroom.png' },
  avocado: { label: 'Pestle avocado', image: 'assets/avatars/character-avocado.png' },
  corn: { label: 'Whisk corn', image: 'assets/avatars/character-corn.png' },
  radish: { label: 'Measure radish', image: 'assets/avatars/character-radish.png' },
  broccoli: { label: 'Grater broccoli', image: 'assets/avatars/character-broccoli.png' },
  eggplant: { label: 'Rolling eggplant', image: 'assets/avatars/character-eggplant.png' },
  potato: { label: 'Masher potato', image: 'assets/avatars/character-potato.png' },
  pea: { label: 'Spoon pea pod', image: 'assets/avatars/character-pea.png' },
  rosemary: { label: 'Brush rosemary', image: 'assets/avatars/character-rosemary.png' },
  pepper: { label: 'Colander pepper', image: 'assets/avatars/character-pepper.png' },
};
const AVATAR_FLAVORS = {
  savory: { label: 'Savory', image: 'assets/avatars/flavor-savory.png' },
  spicy: { label: 'Spicy', image: 'assets/avatars/flavor-spicy.png' },
  umami: { label: 'Umami', image: 'assets/avatars/flavor-umami.png' },
  minty: { label: 'Minty', image: 'assets/avatars/flavor-minty.png' },
  sweet: { label: 'Sweet', image: 'assets/avatars/flavor-sweet.png' },
  smoky: { label: 'Smoky', image: 'assets/avatars/flavor-smoky.png' },
  citrusy: { label: 'Citrusy', image: 'assets/avatars/flavor-citrusy.png' },
  garlicky: { label: 'Garlicky', image: 'assets/avatars/flavor-garlicky.png' },
  herby: { label: 'Herby', image: 'assets/avatars/flavor-herby.png' },
  cheesy: { label: 'Cheesy', image: 'assets/avatars/flavor-cheesy.png' },
  earthy: { label: 'Earthy', image: 'assets/avatars/flavor-earthy.png' },
  buttery: { label: 'Buttery', image: 'assets/avatars/flavor-buttery.png' },
};

function normalizedClientAvatar(value = {}) {
  const legacyCharacter = { chef: 'chef' };
  const legacyFlavor = { fire: 'spicy', heart: 'sweet', star: 'umami', spoon: 'savory' };
  const avatar = { ...AVATAR_DEFAULT, ...value };
  avatar.character = AVATAR_CHARACTERS[avatar.character] ? avatar.character : (legacyCharacter[avatar.accessory] || 'classic');
  avatar.flavor = AVATAR_FLAVORS[avatar.flavor] ? avatar.flavor : (legacyFlavor[avatar.badge] || 'savory');
  return avatar;
}

function avatarTemplate(profile = {}, extraClass = '') {
  const avatar = normalizedClientAvatar(profile.avatar || {});
  const character = AVATAR_CHARACTERS[avatar.character] || AVATAR_CHARACTERS.classic;
  const flavor = AVATAR_FLAVORS[avatar.flavor] || AVATAR_FLAVORS.savory;
  return `<span class="recipeboy-avatar avatar-${esc(avatar.background)} character-${esc(avatar.character)} ${esc(extraClass)}">
    <img class="avatar-character" src="${esc(character.image)}" alt="">
    <span class="avatar-flavor" aria-hidden="true"><img src="${esc(flavor.image)}" alt=""></span>
  </span>`;
}

function starText(rating) {
  return `${'★'.repeat(Math.max(0, Math.min(5, Number(rating) || 0)))}${'☆'.repeat(Math.max(0, 5 - (Number(rating) || 0)))}`;
}

function ratingSummary(recipe) {
  return recipe.ratingCount ? `${Number(recipe.ratingAverage).toFixed(1)} ★ · ${recipe.ratingCount}` : 'Not rated yet';
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

async function api(path, options = {}) {
  const { allowAnonymous = false, ...fetchOptions } = options;
  const isFormData = typeof FormData !== 'undefined' && fetchOptions.body instanceof FormData;
  const request = async (token) => fetch(API + path, {
    ...fetchOptions,
    headers: {
      ...(fetchOptions.body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(fetchOptions.headers || {}),
    },
  });
  let token = await authClient?.getToken();
  if (!token && !allowAnonymous) throw new Error('Sign in to use the shared recipe box.');
  let response = await request(token);
  if (response.status === 401) {
    token = await authClient?.getToken({ skipCache: true });
    if (token) response = await request(token);
  }
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

const bookmarkletSource = `(()=>{const tidy=s=>String(s||'').replace(/\\n{3,}/g,'\\n\\n').trim();const title=tidy(document.title.replace(/\\s*[-|:]\\s*Reddit.*$/i,''));const selected=tidy(String(getSelection()));const nodes=[...document.querySelectorAll('shreddit-post,[data-testid="post-container"],article,.usertext-body,.entry')];const score=e=>{const t=tidy(e.innerText);return (/ingredients?|directions?|instructions?|method/i.test(t)?100000:0)+Math.min(t.length,50000)};nodes.sort((a,b)=>score(b)-score(a));const pageText=selected||tidy(nodes[0]?.innerText)||tidy(document.querySelector('main')?.innerText)||tidy(document.body.innerText);if(pageText.length<40){alert('Recipeboy could not find enough recipe text on this page. Select the recipe text and try again.');return}const payload=encodeURIComponent(JSON.stringify({text:(title+'\\n'+pageText).slice(0,48000),sourceUrl:location.href,sourceTitle:title}));open('https://recipeboy.bensonperry.com/#clip='+payload,'_blank','noopener')})()`;
const BOOKMARKLET_DISMISSED_KEY = 'recipeboy-bookmarklet-dismissed';

el.bookmarkletDock.hidden = true;

function bookmarkletWasDismissed() {
  try { return localStorage.getItem(BOOKMARKLET_DISMISSED_KEY) === '1'; } catch { return false; }
}

el.bookmarklet.setAttribute('href', `javascript:${bookmarkletSource}`);
el.bookmarklet.addEventListener('click', (event) => {
  event.preventDefault();
  showToast('Drag this button to your bookmarks bar!');
});
el.bookmarkletDismiss.addEventListener('click', () => {
  el.bookmarkletDock.hidden = true;
  try { localStorage.setItem(BOOKMARKLET_DISMISSED_KEY, '1'); } catch {}
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
  const prefix = timeIsEstimated(recipe) ? '≈ ' : '';
  return `${prefix}${formatDuration(minutes)}`;
}

function ingredientText(ingredient) {
  return [ingredient.amount, ingredient.unit, ingredient.item].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

const FRACTION_VALUES = { '¼': .25, '½': .5, '¾': .75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': .125, '⅜': .375, '⅝': .625, '⅞': .875 };

function numericTokenValue(token) {
  if (FRACTION_VALUES[token]) return FRACTION_VALUES[token];
  if (/^\d+\s+\d+\/\d+$/.test(token)) {
    const [whole, fraction] = token.split(/\s+/);
    const [top, bottom] = fraction.split('/').map(Number);
    return Number(whole) + top / bottom;
  }
  if (/^\d+\/\d+$/.test(token)) {
    const [top, bottom] = token.split('/').map(Number);
    return top / bottom;
  }
  return Number(token);
}

function friendlyNumber(value) {
  if (!Number.isFinite(value)) return '';
  const rounded = Math.round(value * 24) / 24;
  if (Math.abs(rounded - Math.round(rounded)) < .001) return String(Math.round(rounded));
  const whole = Math.floor(rounded);
  const fraction = rounded - whole;
  const choices = [[1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'], [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞']];
  const closest = choices.reduce((best, choice) => Math.abs(choice[0] - fraction) < Math.abs(best[0] - fraction) ? choice : best, choices[0]);
  if (Math.abs(closest[0] - fraction) > .045) return String(Math.round(rounded * 100) / 100);
  return `${whole || ''}${whole ? ' ' : ''}${closest[1]}`;
}

function scaleAmount(amount, scale = 1) {
  if (scale === 1 || !amount) return String(amount || '');
  return String(amount).replace(/\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞]/g, (token) => friendlyNumber(numericTokenValue(token) * scale));
}

function scaleYield(value, scale = 1) {
  if (scale === 1 || !value) return String(value || '');
  let count = 0;
  let firstEnd = -1;
  const source = String(value);
  return source.replace(/\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞]/g, (token, offset) => {
    const isFirst = count === 0;
    const isJoinedRange = count === 1 && /^\s*(?:to|[-–—])\s*$/i.test(source.slice(firstEnd, offset));
    count += 1;
    if (!isFirst && !isJoinedRange) return token;
    if (isFirst) firstEnd = offset + token.length;
    return friendlyNumber(numericTokenValue(token) * scale);
  });
}

function scaledIngredientText(ingredient, scale = 1) {
  return [scaleAmount(ingredient.amount, scale), ingredient.unit, ingredient.item].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function shoppingList(recipe, scale = 1) {
  return recipe.ingredients.map((ingredient) => `☐ ${scaledIngredientText(ingredient, scale)}`).join('\n');
}

function recipePermalink(id) {
  return `${location.origin}${location.pathname}#recipe=${encodeURIComponent(id)}`;
}

function recipeIdFromHash() {
  if (!location.hash.startsWith('#recipe=')) return '';
  const id = location.hash.slice('#recipe='.length);
  return /^[a-zA-Z0-9-]+$/.test(id) ? id : '';
}

function recipePhotoUrl(photo) {
  const path = String(photo?.url || '');
  return path.startsWith('/') ? `${API}${path}` : safeUrl(path);
}

async function prepareRecipePhoto(file) {
  if (!file?.type?.startsWith('image/')) throw new Error('Choose an image file.');
  if (file.size > 12_000_000) throw new Error(`${file.name || 'That photo'} is over 12 MB.`);
  try {
    const bitmap = await createImageBitmap(file);
    const maxSide = 1800;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', .86));
    if (blob) return new File([blob], `${String(file.name || 'recipe-photo').replace(/\.[^.]+$/, '')}.webp`, { type: 'image/webp' });
  } catch {}
  return file;
}

async function uploadRecipePhotos(recipe, files) {
  const selected = [...(files || [])].slice(0, 6);
  if (!selected.length) return [];
  const uploaded = [];
  for (const file of selected) {
    const prepared = await prepareRecipePhoto(file);
    const body = new FormData();
    body.append('photo', prepared, prepared.name);
    const result = await api(`/recipes/${encodeURIComponent(recipe.id)}/photos`, { method: 'POST', body });
    uploaded.push(result.photo);
    recipe.photos = [result.photo, ...(recipe.photos || [])];
  }
  return uploaded;
}

async function copyShoppingList(recipe) {
  const scale = state.activeId === recipe.id ? state.activeScale : 1;
  const scaleNote = scale === 1 ? '' : ` (${friendlyNumber(scale)}×)`;
  const text = `${recipe.title}${scaleNote}\n${shoppingList(recipe, scale)}`;
  await navigator.clipboard.writeText(text);
  showToast('Shopping list copied!');
}

async function copyRecipeLink(id) {
  await navigator.clipboard.writeText(recipePermalink(id));
  showToast('Recipe link copied!');
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
  const activeList = state.lists.find((list) => list.id === state.listId);
  const listedIds = activeList ? new Set(activeList.recipeIds) : null;
  const filtered = state.recipes.filter((recipe) => (!listedIds || listedIds.has(recipe.id)) && (!state.tag || (recipe.tags || []).includes(state.tag)) && (!query || [
    recipe.title,
    recipe.description,
    recipe.sourceName,
    ...(recipe.tags || []),
    ...(recipe.ingredients || []).map((item) => item.item),
  ].join(' ').toLowerCase().includes(query)));
  return filtered.sort((a, b) => {
    if (state.sort === 'top-rated') return (b.ratingAverage || 0) - (a.ratingAverage || 0)
      || (b.ratingCount || 0) - (a.ratingCount || 0)
      || String(b.createdAt).localeCompare(String(a.createdAt));
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

function renderListFilter() {
  const selectedExists = state.lists.some((list) => list.id === state.listId);
  if (!selectedExists) state.listId = '';
  el.listFilter.innerHTML = `<option value="">All recipes</option>${state.lists.map((list) => `<option value="${esc(list.id)}" ${state.listId === list.id ? 'selected' : ''}>${esc(list.name)} (${list.recipeIds.length})</option>`).join('')}`;
  syncCustomSelect(el.listFilter);
}

function syncCustomSelect(select) {
  const wrap = select?.closest('[data-custom-select]');
  if (!wrap) return;
  const selected = select.options[select.selectedIndex] || select.options[0];
  const valueLabel = wrap.querySelector('[data-select-value]');
  const menu = wrap.querySelector('.custom-select-menu');
  if (valueLabel) valueLabel.textContent = selected?.textContent || '';
  if (menu) menu.innerHTML = [...select.options].map((option) => `<button type="button" role="option" aria-selected="${option.value === select.value}" data-select-option="${esc(option.value)}"><span>${esc(option.textContent)}</span>${option.value === select.value ? '<span aria-hidden="true">✓</span>' : ''}</button>`).join('');
}

function closeCustomSelects(except = null) {
  for (const wrap of document.querySelectorAll('[data-custom-select]')) {
    if (wrap === except) continue;
    wrap.querySelector('.custom-select-menu').hidden = true;
    wrap.querySelector('.custom-select-button').setAttribute('aria-expanded', 'false');
  }
}

function closeDetailMenus(except = null) {
  for (const wrap of document.querySelectorAll('[data-detail-more]')) {
    if (wrap === except) continue;
    wrap.querySelector('.detail-more-menu').hidden = true;
    wrap.querySelector('.detail-more-button').setAttribute('aria-expanded', 'false');
  }
}

function cardTemplate(recipe) {
  const time = minutesLabel(recipe);
  const source = recipe.sourceName || (recipe.sourceUrl ? 'From the web' : 'Friends’ recipe');
  const allMakers = recipe.makers || [];
  const makers = allMakers.slice(0, 4);
  const makerNames = allMakers.map((maker) => maker.displayName).filter(Boolean);
  const cookedBy = makerNames.length
    ? makerNames.join(', ')
    : (recipe.madeCount ? `${recipe.madeCount} earlier cook${recipe.madeCount === 1 ? '' : 's'}` : 'Nobody yet');
  const firstPhoto = (recipe.photos || [])[0];
  const addedBy = recipe.addedBy?.displayName;
  return `<article class="recipe-card" data-id="${esc(recipe.id)}">
    <div class="card-color"></div>
    ${firstPhoto ? `<div class="card-photo"><img src="${esc(recipePhotoUrl(firstPhoto))}" alt="A friend's photo of ${esc(recipe.title)}" loading="lazy"></div>` : ''}
    <div class="card-body" data-open="${esc(recipe.id)}" tabindex="0" role="button" aria-label="Open ${esc(recipe.title)}">
      <span class="source-label">${esc(source)}</span>
      <h3>${esc(recipe.title)}</h3>
      <p class="card-description">${esc(recipe.description || 'A recipe worth keeping.')}</p>
      <div class="card-meta">
        ${time ? `<span class="meta-item">◷ ${esc(time)}</span>` : ''}
        ${yieldLabel(recipe) ? `<span class="meta-item" ${recipe.metadataEstimates?.includes('yield') ? 'title="Estimated servings"' : ''}>♨ ${esc(yieldLabel(recipe))}</span>` : ''}
        <span class="meta-item">${recipe.ingredients.length} ingredients</span>
      </div>
      <div class="card-rating ${recipe.ratingCount ? '' : 'unrated'}" aria-label="${esc(ratingSummary(recipe))}"><span aria-hidden="true">★</span><strong>${recipe.ratingCount ? Number(recipe.ratingAverage).toFixed(1) : 'New'}</strong><small>${recipe.ratingCount ? `${recipe.ratingCount} rating${recipe.ratingCount === 1 ? '' : 's'}` : 'Not rated yet'}</small></div>
      ${(recipe.tags || []).length ? `<div class="card-tags" aria-label="Recipe tags">${recipe.tags.map((tag) => `<span class="pill recipe-tag">${esc(tag)}</span>`).join('')}</div>` : ''}
      <div class="card-contributor">${recipe.addedBy ? avatarTemplate(recipe.addedBy, 'avatar-tiny') : ''}<span><small>Added by</small><strong>${esc(addedBy || 'an early Recipeboy friend')}</strong></span></div>
      <div class="card-makers ${makers.length ? '' : 'empty'}" aria-label="Cooked by ${esc(cookedBy)}"><span class="avatar-stack">${makers.map((maker) => avatarTemplate(maker, 'avatar-tiny')).join('')}</span><span><small>Cooked by</small><strong>${esc(cookedBy)}</strong></span></div>
    </div>
    ${state.isSignedIn ? `<div class="card-actions card-actions-three">
      <button data-save-list="${esc(recipe.id)}">Add to list</button>
      <button data-eaten="${esc(recipe.id)}" aria-label="${recipe.eatenByViewer ? 'You already ate this' : 'I ate this'}" ${recipe.eatenByViewer ? 'disabled' : ''}>I ate this</button>
      <button data-made="${esc(recipe.id)}" aria-label="${recipe.madeByViewer ? 'You already cooked this' : 'I cooked this'}" ${recipe.madeByViewer ? 'disabled' : ''}>I cooked this</button>
    </div>` : `<div class="card-actions card-actions-view-only">
      <button data-open="${esc(recipe.id)}">View recipe</button>
      <button data-sign-in>Sign in to save or cook</button>
    </div>`}
  </article>`;
}

function render() {
  const recipes = visibleRecipes();
  renderTagFilters();
  renderListFilter();
  el.grid.innerHTML = recipes.map(cardTemplate).join('');
  const total = state.recipes.length;
  const activeList = state.lists.find((list) => list.id === state.listId);
  el.count.textContent = activeList ? `${recipes.length} recipe${recipes.length === 1 ? '' : 's'} in ${activeList.name}` : `${total} saved recipe${total === 1 ? '' : 's'}`;
  el.empty.hidden = recipes.length > 0;
  if (!recipes.length && (state.query || state.tag)) {
    el.empty.querySelector('h3').textContent = 'No bites found.';
    el.empty.querySelector('p').textContent = 'Try another ingredient, name, or tag.';
  } else {
    el.empty.querySelector('h3').textContent = 'His recipe box is hungry.';
    el.empty.querySelector('p').textContent = 'Paste the first family favorite up above.';
  }
}

function listDialogTemplate(recipe) {
  return `<div class="list-hero"><h2>Add to list</h2><p>${esc(recipe.title)}</p></div>
    <div class="list-dialog-body">
      <div class="list-choices" aria-label="Choose lists">
        ${state.lists.length ? state.lists.map((list) => `<div class="list-choice ${state.listEditId === list.id ? 'editing' : ''}">
          <label class="list-choice-toggle"><input type="checkbox" data-list-toggle="${esc(list.id)}" ${list.recipeIds.includes(recipe.id) ? 'checked' : ''}><span><strong>${esc(list.name)}</strong><small>${list.recipeIds.length} recipe${list.recipeIds.length === 1 ? '' : 's'}</small></span></label>
          ${state.listEditId === list.id ? `<form class="list-rename-form" data-list-rename-form="${esc(list.id)}"><input name="name" value="${esc(list.name)}" maxlength="40" required aria-label="New name for ${esc(list.name)}"><button type="submit">Save</button><button type="button" data-list-rename-cancel>Cancel</button></form>` : `<div class="list-choice-actions"><button type="button" data-list-rename="${esc(list.id)}" aria-label="Rename ${esc(list.name)}">Rename</button><button class="delete ${state.confirmDeleteListId === list.id ? 'confirm' : ''}" type="button" data-list-delete="${esc(list.id)}" aria-label="Delete ${esc(list.name)}">${state.confirmDeleteListId === list.id ? 'Yes, delete' : 'Delete'}</button></div>`}
        </div>`).join('') : '<p class="list-empty">Make your first list below—weeknight hits, party food, things involving unreasonable amounts of garlic…</p>'}
      </div>
      <form id="new-list-form" class="new-list-form"><label for="new-list-name">New list</label><div><input id="new-list-name" name="name" maxlength="40" required placeholder="Weeknight favorites"><button class="primary-button" type="submit">Create & save</button></div></form>
      <button class="action-button list-done" type="button" data-list-done>Done</button>
    </div>`;
}

function openListDialog(id) {
  const recipe = state.recipes.find((item) => item.id === id);
  if (!recipe) return;
  state.listRecipeId = id;
  el.listContent.innerHTML = listDialogTemplate(recipe);
  el.listDialog.showModal();
}

function refreshListDialog() {
  if (!el.listDialog.open || !state.listRecipeId) return;
  const recipe = state.recipes.find((item) => item.id === state.listRecipeId);
  if (recipe) el.listContent.innerHTML = listDialogTemplate(recipe);
}

async function toggleRecipeList(listId, checked) {
  const list = state.lists.find((item) => item.id === listId);
  if (!list || !state.listRecipeId) return;
  const recipeId = state.listRecipeId;
  await api(`/lists/${encodeURIComponent(listId)}/recipes/${encodeURIComponent(recipeId)}`, { method: checked ? 'PUT' : 'DELETE' });
  list.recipeIds = checked ? [...new Set([...list.recipeIds, recipeId])] : list.recipeIds.filter((id) => id !== recipeId);
  render();
  refreshDialog();
  refreshListDialog();
}

async function createList(event) {
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector('button');
  const name = new FormData(form).get('name');
  button.disabled = true;
  try {
    const result = await api('/lists', { method: 'POST', body: JSON.stringify({ name }) });
    state.lists.push(result.list);
    await toggleRecipeList(result.list.id, true);
    showToast(`Saved to ${result.list.name}!`);
  } catch (error) { showToast(error.message); }
  finally { button.disabled = false; }
}

async function renameRecipeList(event) {
  event.preventDefault();
  const form = event.target;
  const listId = form.dataset.listRenameForm;
  const list = state.lists.find((item) => item.id === listId);
  const name = String(new FormData(form).get('name') || '').trim();
  const button = form.querySelector('button[type="submit"]');
  if (!list || !name) return;
  button.disabled = true;
  try {
    const result = await api(`/lists/${encodeURIComponent(listId)}`, { method: 'PUT', body: JSON.stringify({ name }) });
    list.name = result.list.name;
    list.updatedAt = result.list.updatedAt;
    state.listEditId = null;
    render();
    refreshListDialog();
    showToast(`Renamed to ${list.name}.`);
  } catch (error) {
    showToast(error.message);
    button.disabled = false;
  }
}

async function deleteRecipeList(listId) {
  const list = state.lists.find((item) => item.id === listId);
  if (!list) return;
  if (state.confirmDeleteListId !== listId) {
    state.confirmDeleteListId = listId;
    state.listEditId = null;
    refreshListDialog();
    return;
  }
  await api(`/lists/${encodeURIComponent(listId)}`, { method: 'DELETE' });
  state.lists = state.lists.filter((item) => item.id !== listId);
  if (state.listId === listId) state.listId = '';
  state.confirmDeleteListId = null;
  state.listEditId = null;
  render();
  refreshDialog();
  refreshListDialog();
  showToast(`Deleted ${list.name}.`);
}

function socialTemplate(recipe) {
  const makers = recipe.makers || [];
  const eaters = recipe.eaters || [];
  const writtenReviews = (recipe.reviews || []).filter((review) => review.text);
  const selectedRating = Number(recipe.viewerRating || 0);
  const experience = recipe.viewerExperience || (recipe.madeByViewer ? 'cooked' : recipe.eatenByViewer ? 'ate' : '');
  return `<section class="recipe-social" aria-label="Friends’ ratings and notes">
    <div class="social-summary">
      <div>
        <span class="social-eyebrow">The tasting table</span>
        <h3>${recipe.ratingCount ? `${Number(recipe.ratingAverage).toFixed(1)} out of 5` : 'Be the first to rate it'}</h3>
        <p class="big-stars" aria-label="${esc(ratingSummary(recipe))}">${starText(Math.round(recipe.ratingAverage || 0))}</p>
        <p>${recipe.ratingCount || 0} rating${recipe.ratingCount === 1 ? '' : 's'}</p>
      </div>
      ${state.isSignedIn ? `<form class="review-form" data-review-form="${esc(recipe.id)}">
        <fieldset class="review-experience">
          <legend class="sr-only">Your experience</legend>
          <div class="experience-options">
            <label><input type="radio" name="experience" value="cooked" required ${experience === 'cooked' ? 'checked' : ''}><span>I cooked it</span></label>
            <label><input type="radio" name="experience" value="ate" required ${experience === 'ate' ? 'checked' : ''}><span>I ate it</span></label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Your rating</legend>
          <input type="hidden" name="rating" value="${selectedRating}">
          <div class="star-picker" aria-label="Choose a rating from 1 to 5">
            ${[1, 2, 3, 4, 5].map((rating) => `<button type="button" class="star-choice ${rating <= selectedRating ? 'selected' : ''}" data-rating="${rating}" aria-label="${rating} star${rating === 1 ? '' : 's'}" aria-pressed="${rating === selectedRating}">★</button>`).join('')}
          </div>
        </fieldset>
        <label for="review-${esc(recipe.id)}">A note for your friends <span>optional</span></label>
        <textarea id="review-${esc(recipe.id)}" name="review" rows="3" maxlength="1000" placeholder="Worth doubling? Better with extra garlic?">${esc(recipe.viewerReview || '')}</textarea>
        <label for="review-photos-${esc(recipe.id)}">Photos from your meal <span>optional</span></label>
        <input class="review-photo-input" id="review-photos-${esc(recipe.id)}" name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple>
        <p class="review-cook-note">Cooked it or just enjoyed it? Both get a say. Eating won’t count as cooking.</p>
        <div class="review-form-actions">
          <button class="primary-button" type="submit">${selectedRating ? 'Update review' : 'Save review'}</button>
          ${selectedRating ? `<button class="text-button" type="button" data-remove-review="${esc(recipe.id)}">Remove mine</button>` : ''}
        </div>
      </form>` : `<div class="viewer-social-cta"><span class="social-eyebrow">Want a seat?</span><h3>Join the tasting table</h3><p>Cooked it or ate it? Sign in to rate this recipe, leave a note, and share photos from your meal.</p><button class="primary-button" type="button" data-sign-in>Sign in to join</button></div>`}
    </div>
    <div class="friend-columns">
      <div class="made-by-panel">
        <h3>Cooked by</h3>
        ${makers.length ? `<div class="maker-list">${makers.map((maker) => `<div class="maker-chip">${avatarTemplate(maker, 'avatar-small')}<span>${esc(maker.displayName)}</span></div>`).join('')}</div>` : '<p>No cooks yet. You could be first.</p>'}
        <h3 class="eaten-by-heading">Eaten by</h3>
        ${eaters.length ? `<div class="maker-list eater-list">${eaters.map((eater) => `<div class="maker-chip">${avatarTemplate(eater, 'avatar-small')}<span>${esc(eater.displayName)}</span></div>`).join('')}</div>` : '<p>No tasters yet. Grab a seat!</p>'}
      </div>
      <div class="reviews-panel">
        <h3>Friend notes</h3>
        ${writtenReviews.length ? `<div class="review-list">${writtenReviews.map((review) => `<article class="friend-review">
          ${avatarTemplate(review, 'avatar-small')}
          <div><div class="review-heading"><strong>${esc(review.displayName)}</strong><span aria-label="${review.rating} out of 5 stars">${starText(review.rating)}</span></div>${review.experience ? `<small class="review-perspective">${review.experience === 'ate' ? 'Ate it' : 'Cooked it'}</small>` : ''}<p>${esc(review.text)}</p></div>
        </article>`).join('')}</div>` : '<p>No notes yet—just hungry anticipation.</p>'}
      </div>
    </div>
  </section>`;
}

function detailTemplate(recipe) {
  const sourceUrl = safeUrl(recipe.sourceUrl);
  const scale = state.activeScale || 1;
  const ingredients = recipe.ingredients.map((ingredient) => {
    const quantity = [scaleAmount(ingredient.amount, scale), ingredient.unit].filter(Boolean).join(' ');
    return `<li><strong class="ingredient-name">${esc(ingredient.item)}</strong>${quantity ? `<span class="ingredient-quantity">${esc(quantity)}</span>` : ''}</li>`;
  }).join('');
  const steps = recipe.instructions.map((step) => `<li>${esc(step)}</li>`).join('');
  const time = minutesLabel(recipe);
  const photos = recipe.photos || [];
  const deleteConfirming = state.confirmDeleteId === recipe.id;
  return `<div class="detail-hero">
      <span class="source-label">${esc(recipe.sourceName || 'Friends’ recipe')}</span>
      <h2>${esc(recipe.title)}</h2>
      ${recipe.description ? `<p>${esc(recipe.description)}</p>` : ''}
      <div class="detail-meta">
        ${time ? `<span class="meta-item">◷ ${esc(time)}</span>` : ''}
        ${yieldLabel(recipe) ? `<span class="meta-item" ${recipe.metadataEstimates?.includes('yield') ? 'title="Estimated servings"' : ''}>♨ ${esc(yieldLabel(recipe, scaleYield(normalizeYield(recipe.yield), scale)))}</span>` : ''}
      </div>
      ${(recipe.tags || []).length ? `<div class="detail-tags" aria-label="Recipe tags">${recipe.tags.map((tag) => `<span class="pill recipe-tag">${esc(tag)}</span>`).join('')}</div>` : ''}
    </div>
    <div class="detail-actions">
      <div class="detail-primary-actions">
        <div class="detail-scale" data-detail-more>
          <button class="action-button detail-more-button scale-toggle" type="button" aria-expanded="false" aria-controls="recipe-scale-panel" aria-label="Scale recipe, currently ${esc(friendlyNumber(scale))} times" title="Scale recipe">${esc(friendlyNumber(scale))}× <svg class="dropdown-chevron" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m4 6 4 4 4-4"/></svg></button>
          <div class="detail-more-menu scale-menu" id="recipe-scale-panel" role="group" aria-label="Scale recipe quantities" hidden><span class="scale-label">Recipe size</span><div class="recipe-scale"><button type="button" data-scale-step="-1" aria-label="Scale recipe down" ${scale <= .5 ? 'disabled' : ''}>−</button><strong aria-live="polite">${esc(friendlyNumber(scale))}×</strong><button type="button" data-scale-step="1" aria-label="Scale recipe up" ${scale >= 4 ? 'disabled' : ''}>+</button></div></div>
        </div>
        <button class="action-button detail-secondary-action" data-copy="${esc(recipe.id)}" aria-label="Copy shopping list">Copy list</button>
        ${state.isSignedIn ? `<button class="action-button detail-secondary-action" data-save-list="${esc(recipe.id)}">Add to list</button>
        <div class="detail-experience-actions" role="group" aria-label="Your meal">
          <button class="action-button eaten" data-eaten="${esc(recipe.id)}" aria-label="${recipe.eatenByViewer ? 'You already ate this' : 'I ate this'}; ${recipe.eatenCount || 0} tasters" ${recipe.eatenByViewer ? 'disabled' : ''}>Ate!<span class="detail-action-count" aria-hidden="true"> · ${recipe.eatenCount || 0}</span></button>
          <button class="action-button made" data-made="${esc(recipe.id)}" aria-label="${recipe.madeByViewer ? 'You already cooked this' : 'I cooked this'}; ${recipe.madeCount || 0} cooks" ${recipe.madeByViewer ? 'disabled' : ''}>Cooked!<span class="detail-action-count" aria-hidden="true"> · ${recipe.madeCount || 0}</span></button>
        </div>` : '<button class="action-button viewer-sign-in" type="button" data-sign-in>Sign in</button>'}
      </div>
      <div class="detail-more" data-detail-more>
        <button class="action-button detail-more-button" type="button" aria-haspopup="menu" aria-expanded="${deleteConfirming}" aria-label="More recipe actions"><span class="detail-more-label">More</span><span class="detail-more-dots" aria-hidden="true">•••</span></button>
        <div class="detail-more-menu" role="menu" ${deleteConfirming ? '' : 'hidden'}>
          <button class="detail-overflow-action" type="button" role="menuitem" data-copy="${esc(recipe.id)}"><span>Copy shopping list</span></button>
          ${state.isSignedIn ? `<button class="detail-overflow-action" type="button" role="menuitem" data-save-list="${esc(recipe.id)}"><span>Add to list</span></button>` : ''}
          <button type="button" role="menuitem" data-share="${esc(recipe.id)}"><span>Copy recipe link</span><span class="detail-menu-icon" aria-hidden="true">↗</span></button>
          ${sourceUrl ? `<a role="menuitem" href="${esc(sourceUrl)}" target="_blank" rel="noopener"><span>View original recipe</span><span class="detail-menu-icon" aria-hidden="true">↗</span></a>` : ''}
          ${recipe.canEdit ? `<button type="button" role="menuitem" data-edit-recipe="${esc(recipe.id)}"><span>Edit recipe</span><span class="detail-menu-icon" aria-hidden="true">✎</span></button>` : ''}
          ${state.isSignedIn ? `<button class="detail-more-danger ${deleteConfirming ? 'confirm' : ''}" type="button" role="menuitem" data-delete="${esc(recipe.id)}"><span>${deleteConfirming ? 'Yes, delete recipe' : 'Delete recipe'}</span><span class="detail-menu-icon" aria-hidden="true">${deleteConfirming ? '!' : '×'}</span></button>` : ''}
        </div>
      </div>
    </div>
    <div class="recipe-columns">
      <section><h3>What you need</h3><ul class="ingredient-list">${ingredients || '<li>Ingredients weren’t listed.</li>'}</ul></section>
      <section><h3>What to do</h3><ol class="steps">${steps || '<li>Instructions weren’t listed.</li>'}</ol></section>
    </div>
    <section class="recipe-photos" aria-label="Meal photos">
      <div class="recipe-photos-heading"><div><span class="social-eyebrow">At the table</span><h3>Meal photos</h3></div></div>
      ${photos.length ? `<div class="photo-gallery">${photos.map((photo, index) => `<figure class="photo-frame photo-frame-${(index % 3) + 1}"><img src="${esc(recipePhotoUrl(photo))}" alt="A friend's photo of ${esc(recipe.title)}" loading="lazy"><figcaption>${photo.addedBy ? `Photo by ${esc(photo.addedBy.displayName)}` : 'From a Recipeboy friend'}</figcaption>${state.isSignedIn ? `<button type="button" data-delete-photo="${esc(photo.id)}" data-recipe-id="${esc(recipe.id)}" aria-label="Remove this photo">×</button>` : ''}</figure>`).join('')}</div>` : '<p class="photo-empty">No snapshots yet. Show your friends how it turned out!</p>'}
    </section>
    ${socialTemplate(recipe)}`;
}

function openRecipe(id, updateHash = true) {
  const recipe = state.recipes.find((item) => item.id === id);
  if (!recipe) return;
  state.activeId = id;
  state.activeScale = 1;
  state.confirmDeleteId = null;
  el.dialogContent.innerHTML = detailTemplate(recipe);
  el.dialog.showModal();
  if (updateHash && location.hash !== `#recipe=${encodeURIComponent(id)}`) {
    history.pushState(null, '', `#recipe=${encodeURIComponent(id)}`);
  }
}

function refreshDialog() {
  if (!state.activeId || !el.dialog.open) return;
  const recipe = state.recipes.find((item) => item.id === state.activeId);
  if (recipe) el.dialogContent.innerHTML = detailTemplate(recipe);
}

function adjustRecipeScale(direction) {
  const scaleOpen = el.dialogContent.querySelector('.scale-toggle')?.getAttribute('aria-expanded') === 'true';
  const scales = [.5, 1, 1.5, 2, 3, 4];
  const current = Math.max(0, scales.indexOf(state.activeScale));
  state.activeScale = scales[Math.max(0, Math.min(scales.length - 1, current + direction))];
  refreshDialog();
  if (scaleOpen) {
    el.dialogContent.querySelector('.scale-menu').hidden = false;
    const toggle = el.dialogContent.querySelector('.scale-toggle');
    toggle.setAttribute('aria-expanded', 'true');
    const step = el.dialogContent.querySelector(`[data-scale-step="${direction}"]`);
    (step.disabled ? toggle : step).focus({ preventScroll: true });
  }
}

function editRecipeTemplate(recipe) {
  const ingredients = recipe.ingredients.map(ingredientText).join('\n');
  const instructions = recipe.instructions.join('\n');
  const prepTime = formatDuration(recipe.prepMinutes);
  const cookTime = formatDuration(recipe.cookMinutes);
  const calculatedTotal = formatDuration((recipe.prepMinutes || 0) + (recipe.cookMinutes || 0));
  return `<div class="edit-hero"><span class="social-eyebrow">Tidy the keeper</span><h2>Edit recipe</h2><p>These changes update the shared recipe for everyone.</p></div>
    <form id="recipe-edit-form" class="recipe-edit-form" data-edit-id="${esc(recipe.id)}">
      <label class="edit-wide">Recipe name<input name="title" maxlength="160" required value="${esc(recipe.title)}"></label>
      <label class="edit-wide">Description<textarea name="description" rows="3" maxlength="1000" placeholder="What makes this one worth keeping?">${esc(recipe.description || '')}</textarea></label>
      <div class="edit-small-fields">
        <label>Yield<input name="yield" maxlength="100" value="${esc(recipe.yield || '')}" placeholder="Serves 4"></label>
        <label>Prep time<input name="prepMinutes" type="text" inputmode="text" maxlength="80" value="${esc(prepTime)}" placeholder="20 min"></label>
        <label>Cook time<input name="cookMinutes" type="text" inputmode="text" maxlength="80" value="${esc(cookTime)}" placeholder="3 hr 15 min"></label>
        <div class="edit-time-total"><span>Total time</span><output data-edit-total-time aria-live="polite">${esc(calculatedTotal || '—')}</output></div>
      </div>
      <label class="edit-wide">Tags <span>comma separated</span><input name="tags" maxlength="500" value="${esc((recipe.tags || []).join(', '))}" placeholder="weeknight, spicy, vegetarian"></label>
      <div class="edit-columns">
        <label>Ingredients <span>one per line</span><textarea name="ingredients" rows="12" required>${esc(ingredients)}</textarea></label>
        <label>Instructions <span>one step per line</span><textarea name="instructions" rows="12" required>${esc(instructions)}</textarea></label>
      </div>
      <div class="edit-actions"><button class="primary-button" type="submit">Save recipe</button><button class="action-button" type="button" data-cancel-edit>Cancel</button></div>
    </form>`;
}

function openRecipeEditor(id) {
  const recipe = state.recipes.find((item) => item.id === id);
  if (!recipe) return;
  el.editContent.innerHTML = editRecipeTemplate(recipe);
  el.editDialog.showModal();
}

function updateEditTimeTotal(form) {
  const inputs = ['prepMinutes', 'cookMinutes'].map((name) => form.elements.namedItem(name));
  let total = 0;
  for (const input of inputs) {
    const value = String(input.value || '').trim();
    const minutes = parseDuration(value);
    const validZero = /^0(?:\s|$)/.test(value);
    input.setCustomValidity(value && !minutes && !validZero ? 'Try a time like “20 min” or “3 hours 15 minutes”.' : '');
    total += minutes;
  }
  form.querySelector('[data-edit-total-time]').textContent = formatDuration(total) || '—';
}

async function saveRecipeEdit(event) {
  event.preventDefault();
  const form = event.target;
  const id = form.dataset.editId;
  const recipe = state.recipes.find((item) => item.id === id);
  if (!recipe) return;
  const data = new FormData(form);
  const lines = (name) => String(data.get(name) || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const result = await api(`/recipes/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({
        title: data.get('title'),
        description: data.get('description'),
        yield: data.get('yield'),
        prepMinutes: data.get('prepMinutes'),
        cookMinutes: data.get('cookMinutes'),
        tags: String(data.get('tags') || '').split(',').map((tag) => tag.trim()).filter(Boolean),
        ingredients: lines('ingredients'),
        instructions: lines('instructions'),
      }),
    });
    Object.assign(recipe, result.recipe);
    el.editDialog.close();
    render();
    refreshDialog();
    showToast('Recipe tidied and saved!');
  } catch (error) { showToast(error.message); }
  finally { button.disabled = false; }
}

function profileTemplate(profile) {
  const avatar = normalizedClientAvatar(profile.avatar || {});
  const backgrounds = [
    ['sunshine', 'Sunshine', '#ffd43b'], ['tomato', 'Tomato', '#ff6975'], ['blueberry', 'Blueberry', '#72a9ff'], ['mint', 'Mint', '#9cdb88'],
    ['grape', 'Grape', '#c9a7ff'], ['peach', 'Peach', '#ffb477'], ['aqua', 'Aqua', '#70d6d0'], ['bubblegum', 'Bubble gum', '#f7a8d9'],
  ];
  return `<div class="profile-hero">
      <div id="profile-avatar-preview" class="profile-avatar-preview">${avatarTemplate(profile, 'avatar-large')}</div>
      <div><span class="social-eyebrow">Your tiny sous-chef</span><h2>Make him yours</h2><p>Your Recipeboy follows your lists, ratings, reviews, and cooking victories around the shared box.</p></div>
    </div>
    <form id="profile-form" class="profile-form">
      <label class="profile-name">Display name<input name="displayName" maxlength="32" required value="${esc(profile.displayName || '')}"></label>
      <fieldset><legend>Backdrop</legend><div class="avatar-options color-options">${backgrounds.map(([value, label, color]) => `<label class="avatar-option color-option" style="--swatch:${color}"><input type="radio" name="background" value="${value}" ${avatar.background === value ? 'checked' : ''}><span class="color-swatch" aria-hidden="true"></span><strong>${label}</strong></label>`).join('')}</div></fieldset>
      <fieldset><legend>Choose your Recipeboy</legend><div class="avatar-options character-options">${Object.entries(AVATAR_CHARACTERS).map(([value, option]) => `<label class="avatar-option character-option character-${value}"><input type="radio" name="character" value="${value}" ${avatar.character === value ? 'checked' : ''}><span class="option-art character-art"><img src="${esc(option.image)}" alt=""></span><strong>${esc(option.label)}</strong></label>`).join('')}</div></fieldset>
      <fieldset><legend>Favorite flavor</legend><div class="avatar-options flavor-options">${Object.entries(AVATAR_FLAVORS).map(([value, option]) => `<label class="avatar-option flavor-option"><input type="radio" name="flavor" value="${value}" ${avatar.flavor === value ? 'checked' : ''}><span class="option-art flavor-art"><img src="${esc(option.image)}" alt=""></span><strong>${esc(option.label)}</strong></label>`).join('')}</div></fieldset>
      <div class="profile-actions"><button class="primary-button" type="submit">Save my Recipeboy</button><span class="profile-account-links"><button id="clerk-account-button" class="text-button" type="button">Account & sign-in settings</button><button class="text-button profile-sign-out" type="button" data-profile-sign-out>Sign out</button></span></div>
    </form>`;
}

function renderAccountProfile() {
  if (!state.profile) return;
  el.accountAvatar.innerHTML = avatarTemplate(state.profile, 'avatar-account');
  el.accountLabel.textContent = state.profile.displayName;
  el.account.setAttribute('aria-label', `Profile: ${state.profile.displayName}`);
  el.floatingRecipeboy.innerHTML = avatarTemplate(state.profile, 'avatar-floating');
}

function openProfile() {
  if (!state.profile) return;
  el.profileContent.innerHTML = profileTemplate(state.profile);
  el.profileDialog.showModal();
}

function profileFormAvatar(form) {
  const data = new FormData(form);
  return { background: data.get('background'), character: data.get('character'), flavor: data.get('flavor') };
}

function refreshProfilePreview() {
  const form = document.getElementById('profile-form');
  const preview = document.getElementById('profile-avatar-preview');
  if (!form || !preview) return;
  preview.innerHTML = avatarTemplate({ avatar: profileFormAvatar(form) }, 'avatar-large');
}

function replaceViewerProfile(profile) {
  for (const recipe of state.recipes) {
    if (recipe.addedBy?.isViewer) recipe.addedBy = { ...recipe.addedBy, ...profile };
    recipe.makers = (recipe.makers || []).map((maker) => maker.isViewer ? { ...maker, ...profile } : maker);
    recipe.eaters = (recipe.eaters || []).map((eater) => eater.isViewer ? { ...eater, ...profile } : eater);
    recipe.reviews = (recipe.reviews || []).map((review) => review.isViewer ? { ...review, ...profile } : review);
    recipe.photos = (recipe.photos || []).map((photo) => photo.addedBy?.isViewer ? { ...photo, addedBy: { ...photo.addedBy, ...profile } } : photo);
  }
}

async function saveProfile(event) {
  event.preventDefault();
  const form = event.target.closest('#profile-form');
  const data = new FormData(form);
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const result = await api('/profile', { method: 'PUT', body: JSON.stringify({ displayName: data.get('displayName'), avatar: profileFormAvatar(form) }) });
    state.profile = result.profile;
    replaceViewerProfile(state.profile);
    renderAccountProfile();
    render();
    refreshDialog();
    el.profileDialog.close();
    showToast('Your little Recipeboy is ready!');
  } catch (error) { showToast(error.message); }
  finally { button.disabled = false; }
}

async function saveReview(event) {
  event.preventDefault();
  const form = event.target.closest('[data-review-form]');
  if (!form) return;
  const id = form.dataset.reviewForm;
  const recipe = state.recipes.find((item) => item.id === id);
  const data = new FormData(form);
  const rating = Number(data.get('rating'));
  const experience = data.get('experience');
  const photos = [...(form.elements.photos?.files || [])];
  if (!rating) return showToast('Tap a star first!');
  if (!['cooked', 'ate'].includes(experience)) return showToast('Choose whether you cooked it or ate it.');
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    Object.assign(recipe, await api(`/recipes/${encodeURIComponent(id)}/review`, { method: 'POST', body: JSON.stringify({ rating, review: data.get('review'), experience }) }));
    let photoWarning = '';
    if (photos.length) {
      button.textContent = 'Framing your photos…';
      try { await uploadRecipePhotos(recipe, photos); }
      catch (error) { photoWarning = ` Review saved, but a photo failed: ${error.message}`; }
    }
    render();
    refreshDialog();
    showToast(photoWarning || (photos.length ? 'Review and meal photos saved!' : 'Review saved!'));
  } catch (error) { showToast(error.message); }
  finally { button.disabled = false; }
}

async function removeReview(id) {
  const recipe = state.recipes.find((item) => item.id === id);
  if (!recipe) return;
  try {
    Object.assign(recipe, await api(`/recipes/${encodeURIComponent(id)}/review`, { method: 'DELETE' }));
    render();
    refreshDialog();
    showToast('Your rating was removed.');
  } catch (error) { showToast(error.message); }
}

async function markMade(id) {
  const recipe = state.recipes.find((item) => item.id === id);
  if (!recipe) return;
  try {
    const result = await api(`/recipes/${encodeURIComponent(id)}/made`, { method: 'POST' });
    recipe.madeCount = result.madeCount;
    recipe.madeByViewer = true;
    if (!result.alreadyMade && result.maker) recipe.makers = [...(recipe.makers || []), result.maker];
    render();
    refreshDialog();
    showToast(result.alreadyMade ? 'Recipeboy already counted this cook!' : (result.madeCount === 1 ? 'First cook! Legendary.' : `${result.madeCount} cooks and counting!`));
  } catch (error) { showToast(error.message); }
}

async function markEaten(id) {
  const recipe = state.recipes.find((item) => item.id === id);
  if (!recipe) return;
  try {
    const result = await api(`/recipes/${encodeURIComponent(id)}/ate`, { method: 'POST' });
    Object.assign(recipe, result);
    render();
    if (!el.dialog.open || state.activeId !== id) openRecipe(id);
    else refreshDialog();
    const form = el.dialogContent.querySelector('[data-review-form]');
    if (form) {
      form.querySelector('input[value="ate"]').checked = true;
      form.scrollIntoView({ block: 'center', behavior: 'instant' });
      form.querySelector('[data-rating]')?.focus({ preventScroll: true });
    }
    showToast(result.alreadyEaten ? 'Recipeboy already saved your seat!' : 'Counted as a taster, not a cook. How was it?');
  } catch (error) { showToast(error.message); }
}

async function deletePhoto(recipeId, photoId) {
  const recipe = state.recipes.find((item) => item.id === recipeId);
  if (!recipe) return;
  try {
    await api(`/recipes/${encodeURIComponent(recipeId)}/photos/${encodeURIComponent(photoId)}`, { method: 'DELETE' });
    recipe.photos = (recipe.photos || []).filter((photo) => photo.id !== photoId);
    render();
    refreshDialog();
    showToast('Photo removed.');
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
  if (submittingRecipe) return;
  if (!state.isSignedIn) {
    await authClient?.signIn();
    return;
  }
  const input = el.input.value.trim();
  if (!input) return;
  const button = el.form.querySelector('button[type="submit"]');
  setRecipeSubmitting(true);
  button.querySelector('span').textContent = /^https?:\/\//i.test(input) ? 'Reading that page…' : 'Tidying your notes…';
  el.status.hidden = true;
  try {
    const result = await normalizeInput(input, button);
    state.recipes.unshift(result.recipe);
    el.input.value = '';
    el.status.hidden = true;
    render();
    el.addDialog.close();
    openRecipe(result.recipe.id);
    showToast(`Saved “${result.recipe.title}”.`);
  } catch (error) {
    el.status.textContent = error.message;
    el.status.className = 'form-status';
    el.status.hidden = false;
    if (!el.addDialog.open) showToast(error.message);
  } finally {
    setRecipeSubmitting(false);
  }
}

function leaderboardTemplate(title, eyebrow, entries, countLabel) {
  return `<section class="leaderboard"><span class="social-eyebrow">${esc(eyebrow)}</span><h3>${esc(title)}</h3><ol>${entries.length ? entries.map((entry, index) => `<li><span class="leader-rank">${index + 1}</span>${avatarTemplate(entry, 'avatar-small')}<strong>${esc(entry.displayName)}</strong><span class="leader-score">${entry.count} <small>${esc(countLabel(entry.count))}</small></span></li>`).join('') : '<li class="leaderboard-empty">No stats yet—get cooking!</li>'}</ol></section>`;
}

function statsTemplate(stats) {
  return `<div class="stats-hero"><span class="social-eyebrow">The Recipeboy hall of fame</span><h2>Friend stats</h2><p>Three different ways to keep the shared box delicious.</p></div><div class="stats-grid">
    ${leaderboardTemplate('Recipe keepers', 'Added the most', stats.recipesAdded || [], (count) => `recipe${count === 1 ? '' : 's'}`)}
    ${leaderboardTemplate('Kitchen heroes', 'Cooked the most', stats.recipesCooked || [], (count) => `cook${count === 1 ? '' : 's'}`)}
    ${leaderboardTemplate('Tasting panel', 'Reviewed the most', stats.reviewsWritten || [], (count) => `review${count === 1 ? '' : 's'}`)}
  </div>`;
}

async function openStats() {
  el.statsContent.innerHTML = '<div class="stats-loading">Recipeboy is counting spoons…</div>';
  el.statsDialog.showModal();
  try {
    const result = await api('/stats');
    state.stats = result.stats;
    el.statsContent.innerHTML = statsTemplate(state.stats);
  } catch (error) {
    el.statsContent.innerHTML = `<div class="stats-loading">${esc(error.message)}</div>`;
  }
}

function relativeActivityTime(value) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return '';
  const elapsed = Math.max(0, Date.now() - time);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(time));
}

function activityCopy(item) {
  if (item.type === 'cooked') return 'cooked';
  if (item.type === 'ate') return 'ate';
  if (item.type === 'rated') return 'rated';
  return 'added';
}

function activityBadge(item) {
  if (item.type === 'cooked') return 'Cooked';
  if (item.type === 'ate') return 'Ate';
  if (item.type === 'rated') return `★ ${Number(item.rating) || 0}`;
  return 'New';
}

function feedTemplate(activity) {
  return `<div class="feed-hero"><span class="social-eyebrow">Fresh from the shared kitchen</span><h2>Feed</h2><p>The latest recipe victories from your friends.</p></div>
    <div class="feed-body">${activity.length ? `<ol class="activity-feed">${activity.map((item) => `<li class="activity-item activity-${esc(item.type)}">
      ${avatarTemplate(item.actor, 'activity-avatar')}
      <div class="activity-copy"><p><strong>${esc(item.actor?.displayName || 'Recipe friend')}</strong> ${activityCopy(item)} <button type="button" data-feed-recipe="${esc(item.recipeId)}">${esc(item.recipeTitle)}</button></p><time datetime="${esc(item.occurredAt)}">${esc(relativeActivityTime(item.occurredAt))}</time></div>
      <span class="activity-badge">${esc(activityBadge(item))}</span>
    </li>`).join('')}</ol>` : '<div class="feed-empty"><strong>The kitchen is quiet.</strong><span>Add, cook, or rate a recipe and it’ll show up here.</span></div>'}</div>`;
}

async function openFeed() {
  el.feedContent.innerHTML = '<div class="feed-loading">Recipeboy is checking the kitchen…</div>';
  el.feedDialog.showModal();
  try {
    const result = await api('/activity');
    state.activity = result.activity || [];
    el.feedContent.innerHTML = feedTemplate(state.activity);
  } catch (error) {
    el.feedContent.innerHTML = `<div class="feed-loading">${esc(error.message)}</div>`;
  }
}

async function handleAction(event) {
  if (event.target.closest('[data-sign-in]')) {
    await authClient?.signIn();
    return;
  }
  const ratingButton = event.target.closest('[data-rating]');
  if (ratingButton) {
    const form = ratingButton.closest('[data-review-form]');
    const rating = Number(ratingButton.dataset.rating);
    form.elements.rating.value = rating;
    for (const button of form.querySelectorAll('[data-rating]')) {
      const selected = Number(button.dataset.rating) <= rating;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(Number(button.dataset.rating) === rating));
    }
    return;
  }
  const removeReviewButton = event.target.closest('[data-remove-review]');
  if (removeReviewButton) return removeReview(removeReviewButton.dataset.removeReview);
  const scaleButton = event.target.closest('[data-scale-step]');
  if (scaleButton) return adjustRecipeScale(Number(scaleButton.dataset.scaleStep));
  const editButton = event.target.closest('[data-edit-recipe]');
  if (editButton) return openRecipeEditor(editButton.dataset.editRecipe);
  const copyButton = event.target.closest('[data-copy]');
  if (copyButton) {
    const recipe = state.recipes.find((item) => item.id === copyButton.dataset.copy);
    if (recipe) await copyShoppingList(recipe);
    return;
  }
  const shareButton = event.target.closest('[data-share]');
  if (shareButton) {
    await copyRecipeLink(shareButton.dataset.share);
    return;
  }
  const saveListButton = event.target.closest('[data-save-list]');
  if (saveListButton) return openListDialog(saveListButton.dataset.saveList);
  const madeButton = event.target.closest('[data-made]');
  if (madeButton) return markMade(madeButton.dataset.made);
  const eatenButton = event.target.closest('[data-eaten]');
  if (eatenButton) return markEaten(eatenButton.dataset.eaten);
  const deletePhotoButton = event.target.closest('[data-delete-photo]');
  if (deletePhotoButton) return deletePhoto(deletePhotoButton.dataset.recipeId, deletePhotoButton.dataset.deletePhoto);
  const deleteButton = event.target.closest('[data-delete]');
  if (deleteButton) return deleteRecipe(deleteButton.dataset.delete);
  const openTarget = event.target.closest('[data-open]');
  if (openTarget) openRecipe(openTarget.dataset.open);
}

el.form.addEventListener('submit', submitRecipe);
el.input.addEventListener('input', () => { if (!submittingRecipe) el.status.hidden = true; });
el.grid.addEventListener('click', handleAction);
el.grid.addEventListener('keydown', (event) => {
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-open]')) {
    event.preventDefault();
    openRecipe(event.target.dataset.open);
  }
});
el.dialog.addEventListener('click', handleAction);
el.dialog.addEventListener('submit', saveReview);
document.getElementById('dialog-close').addEventListener('click', () => el.dialog.close());
el.dialog.addEventListener('click', (event) => { if (event.target === el.dialog) el.dialog.close(); });
el.dialog.addEventListener('close', () => {
  state.activeId = null;
  state.activeScale = 1;
  state.confirmDeleteId = null;
  if (location.hash.startsWith('#recipe=')) history.replaceState(null, '', `${location.pathname}${location.search}`);
});
el.search.addEventListener('input', () => { state.query = el.search.value; render(); });
el.sort.addEventListener('change', () => { state.sort = el.sort.value; syncCustomSelect(el.sort); render(); });
el.listFilter.addEventListener('change', () => { state.listId = el.listFilter.value; syncCustomSelect(el.listFilter); render(); });
document.addEventListener('click', (event) => {
  const detailMenuToggle = event.target.closest('.detail-more-button');
  if (detailMenuToggle) {
    const wrap = detailMenuToggle.closest('[data-detail-more]');
    const menu = wrap.querySelector('.detail-more-menu');
    const opening = menu.hidden;
    closeDetailMenus(wrap);
    menu.hidden = !opening;
    detailMenuToggle.setAttribute('aria-expanded', String(opening));
    return;
  }
  const detailMenuAction = event.target.closest('.detail-more-menu [role="menuitem"]');
  if (detailMenuAction && !detailMenuAction.matches('[data-delete]')) closeDetailMenus();
  if (!event.target.closest('[data-detail-more]')) closeDetailMenus();
  const option = event.target.closest('[data-select-option]');
  if (option) {
    const wrap = option.closest('[data-custom-select]');
    const select = wrap.querySelector('select');
    select.value = option.dataset.selectOption;
    select.dispatchEvent(new Event('change'));
    closeCustomSelects();
    return;
  }
  const toggle = event.target.closest('.custom-select-button');
  if (toggle) {
    const wrap = toggle.closest('[data-custom-select]');
    const menu = wrap.querySelector('.custom-select-menu');
    const opening = menu.hidden;
    closeCustomSelects(wrap);
    menu.hidden = !opening;
    toggle.setAttribute('aria-expanded', String(opening));
    return;
  }
  if (!event.target.closest('[data-custom-select]')) closeCustomSelects();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    const openDetailMenu = document.querySelector('.detail-more-menu:not([hidden])');
    if (openDetailMenu) {
      event.preventDefault();
      openDetailMenu.closest('[data-detail-more]').querySelector('.detail-more-button').focus();
    }
    closeCustomSelects();
    closeDetailMenus();
  }
});
el.tagFilters.addEventListener('click', (event) => {
  const button = event.target.closest('[data-tag]');
  if (!button) return;
  state.tag = button.dataset.tag;
  render();
});
document.getElementById('profile-close').addEventListener('click', () => el.profileDialog.close());
el.profileDialog.addEventListener('click', (event) => { if (event.target === el.profileDialog) el.profileDialog.close(); });
el.profileDialog.addEventListener('change', (event) => { if (event.target.matches('input[type="radio"]')) refreshProfilePreview(); });
el.profileDialog.addEventListener('submit', (event) => { if (event.target.id === 'profile-form') void saveProfile(event); });
el.profileDialog.addEventListener('click', (event) => {
  if (event.target.closest('#clerk-account-button')) authClient?.openAccount();
  if (event.target.closest('[data-profile-sign-out]')) {
    el.profileDialog.close();
    authClient?.signOut();
  }
});
document.getElementById('edit-close').addEventListener('click', () => el.editDialog.close());
el.editDialog.addEventListener('click', (event) => {
  if (event.target === el.editDialog || event.target.closest('[data-cancel-edit]')) el.editDialog.close();
});
el.editDialog.addEventListener('submit', (event) => { if (event.target.id === 'recipe-edit-form') void saveRecipeEdit(event); });
el.editDialog.addEventListener('input', (event) => {
  if (event.target.matches('[name="prepMinutes"], [name="cookMinutes"]')) updateEditTimeTotal(event.target.form);
});
document.getElementById('list-close').addEventListener('click', () => el.listDialog.close());
el.listDialog.addEventListener('click', (event) => {
  if (event.target === el.listDialog || event.target.closest('[data-list-done]')) el.listDialog.close();
  const rename = event.target.closest('[data-list-rename]');
  if (rename) {
    state.listEditId = rename.dataset.listRename;
    state.confirmDeleteListId = null;
    refreshListDialog();
    const input = el.listContent.querySelector('[data-list-rename-form] input');
    input?.focus();
    input?.select();
  }
  if (event.target.closest('[data-list-rename-cancel]')) {
    state.listEditId = null;
    refreshListDialog();
  }
  const remove = event.target.closest('[data-list-delete]');
  if (remove) void deleteRecipeList(remove.dataset.listDelete).catch((error) => showToast(error.message));
});
el.listDialog.addEventListener('change', (event) => {
  const input = event.target.closest('[data-list-toggle]');
  if (input) void toggleRecipeList(input.dataset.listToggle, input.checked).catch((error) => showToast(error.message));
});
el.listDialog.addEventListener('submit', (event) => {
  if (event.target.id === 'new-list-form') void createList(event);
  if (event.target.matches('[data-list-rename-form]')) void renameRecipeList(event);
});
el.listDialog.addEventListener('close', () => { state.listRecipeId = null; state.listEditId = null; state.confirmDeleteListId = null; });
el.statsButton?.addEventListener('click', () => { void openStats(); });
document.getElementById('stats-close')?.addEventListener('click', () => el.statsDialog.close());
el.statsDialog?.addEventListener('click', (event) => { if (event.target === el.statsDialog) el.statsDialog.close(); });
el.feedButton?.addEventListener('click', () => { void openFeed(); });
document.getElementById('feed-close')?.addEventListener('click', () => el.feedDialog.close());
el.feedDialog?.addEventListener('click', (event) => {
  if (event.target === el.feedDialog) el.feedDialog.close();
  const recipeButton = event.target.closest('[data-feed-recipe]');
  if (recipeButton) {
    el.feedDialog.close();
    openRecipe(recipeButton.dataset.feedRecipe);
  }
});

async function saveClippedRecipe() {
  const clippedRecipe = bookmarkletPayload();
  if (!clippedRecipe?.text) return;
  el.input.value = String(clippedRecipe.text).slice(0, 50_000);
  await openAddRecipe();
  el.status.hidden = true;
  const button = el.form.querySelector('button[type="submit"]');
  setRecipeSubmitting(true);
  button.querySelector('span').textContent = 'Saving from your browser…';
  try {
    const result = await normalizeInput(String(clippedRecipe.text), button, {
      sourceUrl: clippedRecipe.sourceUrl || '',
      sourceTitle: clippedRecipe.sourceTitle || '',
    });
    state.recipes.unshift(result.recipe);
    render();
    el.input.value = '';
    el.status.hidden = true;
    el.addDialog.close();
    openRecipe(result.recipe.id);
    showToast(`Saved “${result.recipe.title}” from your browser.`);
  } catch (error) {
    el.input.value = String(clippedRecipe.text).slice(0, 50_000);
    el.status.textContent = `${error.message} The captured text is in the box so you can tidy it and try again.`;
    el.status.className = 'form-status';
    el.status.hidden = false;
    if (!el.addDialog.open) showToast('Import failed. Open Add recipe to retry your saved text.');
  } finally {
    setRecipeSubmitting(false);
  }
}

async function loadSharedBox() {
  try {
    const [recipeResult, listResult] = await Promise.all([
      api('/recipes', { allowAnonymous: !state.isSignedIn }),
      state.isSignedIn ? api('/lists') : Promise.resolve({ lists: [] }),
    ]);
    state.recipes = recipeResult.recipes || [];
    state.lists = listResult.lists || [];
    el.grid.classList.add('recipe-grid-hydrating');
    render();
    finishAppLoading();
    window.setTimeout(() => el.grid.classList.remove('recipe-grid-hydrating'), 360);
    const linkedRecipeId = recipeIdFromHash();
    if (linkedRecipeId) openRecipe(linkedRecipeId, false);
    if (state.isSignedIn) await saveClippedRecipe();
  } catch (error) {
    el.grid.innerHTML = '';
    el.grid.classList.remove('recipe-grid-hydrating');
    finishAppLoading();
    el.count.textContent = error.message || 'Couldn’t reach the shared box';
    el.empty.hidden = false;
    el.empty.querySelector('h3').textContent = 'Recipeboy is taking a snack break.';
    el.empty.querySelector('p').textContent = 'Try refreshing or signing in again.';
  }
}

async function showSignedOut() {
  loadedUserId = '';
  state.isSignedIn = false;
  state.recipes = [];
  state.lists = [];
  state.profile = null;
  state.activity = null;
  prepareAppLoading();
  document.body.classList.add('view-only');
  el.appMain.hidden = false;
  el.appMain.inert = false;
  el.input.disabled = true;
  el.addButton.disabled = false;
  el.form.querySelector('button[type="submit"] span').textContent = 'Sign in to add';
  el.floatingRecipeboy.innerHTML = '<img src="assets/recipeboy-mascot.svg" alt="">';
  el.floatingRecipeboy.hidden = true;
  if (el.dialog.open) el.dialog.close();
  if (el.editDialog.open) el.editDialog.close();
  if (el.statsDialog.open) el.statsDialog.close();
  if (el.feedDialog.open) el.feedDialog.close();
  if (el.addDialog.open) el.addDialog.close();
  el.authControls.hidden = true;
  el.publicControls.hidden = false;
  el.bookmarkletDock.hidden = true;
  el.authGate.hidden = true;
  await loadSharedBox();
}

async function showSignedIn(user) {
  state.isSignedIn = true;
  document.body.classList.remove('view-only');
  if (loadedUserId !== user.id) prepareAppLoading();
  el.authGate.hidden = true;
  el.appMain.hidden = false;
  el.appMain.inert = false;
  el.input.disabled = false;
  el.addButton.disabled = false;
  el.form.querySelector('button[type="submit"] span').textContent = 'Feed him!';
  el.publicControls.hidden = true;
  el.accountLabel.textContent = user.label;
  el.account.setAttribute('aria-label', `Profile: ${user.label}`);
  el.account.title = 'Customize your Recipeboy';
  if (loadedUserId === user.id) return;
  loadedUserId = user.id;
  state.recipes = [];
  el.count.textContent = 'Opening the shared box…';
  try {
    const result = await api('/profile/ensure', { method: 'POST', body: JSON.stringify({ displayName: user.label, avatar: AVATAR_DEFAULT }) });
    state.profile = result.profile;
    renderAccountProfile();
  } catch {
    state.profile = { displayName: user.label, avatar: AVATAR_DEFAULT };
    renderAccountProfile();
  }
  el.authControls.hidden = false;
  el.floatingRecipeboy.hidden = false;
  el.bookmarkletDock.hidden = bookmarkletWasDismissed();
  await loadSharedBox();
  if (addAfterSignIn) {
    addAfterSignIn = false;
    if (!el.dialog.open) await openAddRecipe();
  }
}

async function handleAuthChange(user) {
  if (user) await showSignedIn(user);
  else showSignedOut();
}

el.signIn.addEventListener('click', () => authClient?.signIn());
el.publicSignIn.addEventListener('click', () => authClient?.signIn());
el.account.addEventListener('click', openProfile);
el.floatingRecipeboy.addEventListener('click', openProfile);
window.addEventListener('hashchange', () => {
  const linkedRecipeId = recipeIdFromHash();
  if (linkedRecipeId) {
    openRecipe(linkedRecipeId, false);
  } else if (el.dialog.open) {
    el.dialog.close();
  }
});

try {
  syncCustomSelect(el.sort);
  authClient = await initAuth({ onChange: (user) => {
    if (!authClient) pendingAuthUser = user;
    else void handleAuthChange(user);
  } });
  const initialUser = pendingAuthUser === undefined ? authClient.user : pendingAuthUser;
  pendingAuthUser = undefined;
  await handleAuthChange(initialUser);
} catch (error) {
  el.appMain.hidden = true;
  el.appMain.inert = true;
  el.authGate.hidden = false;
  el.authMessage.textContent = `${error.message} Refresh the page to try again.`;
  el.signIn.hidden = true;
}
