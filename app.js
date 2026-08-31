import { initAuth } from './auth.js?v=2';

const API = ['localhost', '127.0.0.1'].includes(location.hostname)
  ? 'http://127.0.0.1:8791'
  : 'https://recipeboy-api.bensonperry.workers.dev';

const state = { recipes: [], profile: null, query: '', tag: '', sort: 'newest', activeId: null, confirmDeleteId: null };
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
  profileDialog: document.getElementById('profile-dialog'),
  profileContent: document.getElementById('profile-content'),
  toast: document.getElementById('toast'),
  bookmarkletDock: document.getElementById('bookmarklet-dock'),
  bookmarkletDismiss: document.getElementById('bookmarklet-dismiss'),
  bookmarklet: document.getElementById('recipeboy-bookmarklet'),
  appMain: document.getElementById('app-main'),
  authGate: document.getElementById('auth-gate'),
  authMessage: document.getElementById('auth-message'),
  authControls: document.getElementById('auth-controls'),
  signIn: document.getElementById('sign-in-button'),
  signOut: document.getElementById('sign-out-button'),
  account: document.getElementById('account-button'),
  accountAvatar: document.getElementById('account-avatar'),
  accountLabel: document.getElementById('account-label'),
};

let authClient = null;
let loadedUserId = '';

const esc = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

const AVATAR_DEFAULT = { background: 'sunshine', accessory: 'none', badge: 'spoon' };
const AVATAR_ACCESSORIES = { none: '', chef: '🧑‍🍳', crown: '👑', cowboy: '🤠', party: '🥳' };
const AVATAR_BADGES = { spoon: '🥄', heart: '♥', fire: '🔥', star: '★' };

function avatarTemplate(profile = {}, extraClass = '') {
  const avatar = { ...AVATAR_DEFAULT, ...(profile.avatar || {}) };
  const accessory = AVATAR_ACCESSORIES[avatar.accessory] || '';
  const badge = AVATAR_BADGES[avatar.badge] || AVATAR_BADGES.spoon;
  return `<span class="recipeboy-avatar avatar-${esc(avatar.background)} ${esc(extraClass)}">
    <img src="assets/recipeboy-mascot.svg" alt="">
    ${accessory ? `<span class="avatar-accessory" aria-hidden="true">${accessory}</span>` : ''}
    <span class="avatar-badge" aria-hidden="true">${badge}</span>
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
  const request = async (token) => fetch(API + path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  let token = await authClient?.getToken();
  if (!token) throw new Error('Sign in to use the shared recipe box.');
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

function recipePermalink(id) {
  return `${location.origin}${location.pathname}#recipe=${encodeURIComponent(id)}`;
}

function recipeIdFromHash() {
  if (!location.hash.startsWith('#recipe=')) return '';
  const id = location.hash.slice('#recipe='.length);
  return /^[a-zA-Z0-9-]+$/.test(id) ? id : '';
}

async function copyShoppingList(recipe) {
  const text = `${recipe.title}\n${shoppingList(recipe)}`;
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
  const makers = (recipe.makers || []).slice(0, 4);
  return `<article class="recipe-card" data-id="${esc(recipe.id)}">
    <div class="card-color"></div>
    <div class="card-body" data-open="${esc(recipe.id)}" tabindex="0" role="button" aria-label="Open ${esc(recipe.title)}">
      <span class="source-label">${esc(source)}</span>
      <h3>${esc(recipe.title)}</h3>
      <p class="card-description">${esc(recipe.description || 'A recipe worth keeping.')}</p>
      <div class="card-meta">
        ${time ? `<span class="meta-item">◷ ${esc(time)}</span>` : ''}
        ${recipe.yield ? `<span class="meta-item">♨ ${esc(recipe.yield)}</span>` : ''}
        <span class="meta-item">${recipe.ingredients.length} ingredients</span>
        ${recipe.ratingCount ? `<span class="meta-item rating-summary">★ ${Number(recipe.ratingAverage).toFixed(1)}</span>` : ''}
      </div>
      ${(recipe.tags || []).length ? `<div class="card-tags" aria-label="Recipe tags">${recipe.tags.map((tag) => `<span class="pill recipe-tag">${esc(tag)}</span>`).join('')}</div>` : ''}
      ${makers.length ? `<div class="card-makers" aria-label="Made by ${recipe.madeCount} friends"><span class="avatar-stack">${makers.map((maker) => avatarTemplate(maker, 'avatar-tiny')).join('')}</span><span>${recipe.madeCount} made it</span></div>` : ''}
    </div>
    <div class="card-actions">
      <button data-copy="${esc(recipe.id)}">Copy list</button>
      <button data-made="${esc(recipe.id)}" ${recipe.madeByViewer ? 'disabled' : ''}>${recipe.madeByViewer ? 'You made this!' : 'I made this!'} · ${recipe.madeCount || 0}</button>
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

function socialTemplate(recipe) {
  const makers = recipe.makers || [];
  const writtenReviews = (recipe.reviews || []).filter((review) => review.text);
  const selectedRating = Number(recipe.viewerRating || 0);
  return `<section class="recipe-social" aria-label="Friends’ ratings and notes">
    <div class="social-summary">
      <div>
        <span class="social-eyebrow">The tasting table</span>
        <h3>${recipe.ratingCount ? `${Number(recipe.ratingAverage).toFixed(1)} out of 5` : 'Be the first to rate it'}</h3>
        <p class="big-stars" aria-label="${esc(ratingSummary(recipe))}">${starText(Math.round(recipe.ratingAverage || 0))}</p>
        <p>${recipe.ratingCount || 0} rating${recipe.ratingCount === 1 ? '' : 's'}</p>
      </div>
      <form class="review-form" data-review-form="${esc(recipe.id)}">
        <fieldset>
          <legend>Your rating</legend>
          <input type="hidden" name="rating" value="${selectedRating}">
          <div class="star-picker" aria-label="Choose a rating from 1 to 5">
            ${[1, 2, 3, 4, 5].map((rating) => `<button type="button" class="star-choice ${rating <= selectedRating ? 'selected' : ''}" data-rating="${rating}" aria-label="${rating} star${rating === 1 ? '' : 's'}" aria-pressed="${rating === selectedRating}">★</button>`).join('')}
          </div>
        </fieldset>
        <label for="review-${esc(recipe.id)}">A note for your friends <span>optional</span></label>
        <textarea id="review-${esc(recipe.id)}" name="review" rows="3" maxlength="1000" placeholder="Worth doubling? Better with extra garlic?">${esc(recipe.viewerReview || '')}</textarea>
        <div class="review-form-actions">
          <button class="primary-button" type="submit">${selectedRating ? 'Update rating' : 'Save rating'}</button>
          ${selectedRating ? `<button class="text-button" type="button" data-remove-review="${esc(recipe.id)}">Remove mine</button>` : ''}
        </div>
      </form>
    </div>
    <div class="friend-columns">
      <div class="made-by-panel">
        <h3>Made by</h3>
        ${makers.length ? `<div class="maker-list">${makers.map((maker) => `<div class="maker-chip">${avatarTemplate(maker, 'avatar-small')}<span>${esc(maker.displayName)}</span></div>`).join('')}</div>` : '<p>No cooks yet. You could be first.</p>'}
      </div>
      <div class="reviews-panel">
        <h3>Friend notes</h3>
        ${writtenReviews.length ? `<div class="review-list">${writtenReviews.map((review) => `<article class="friend-review">
          ${avatarTemplate(review, 'avatar-small')}
          <div><div class="review-heading"><strong>${esc(review.displayName)}</strong><span aria-label="${review.rating} out of 5 stars">${starText(review.rating)}</span></div><p>${esc(review.text)}</p></div>
        </article>`).join('')}</div>` : '<p>No notes yet—just hungry anticipation.</p>'}
      </div>
    </div>
  </section>`;
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
        ${time ? `<span class="meta-item">◷ ${esc(time)}</span>` : ''}
        ${recipe.yield ? `<span class="meta-item">♨ ${esc(recipe.yield)}</span>` : ''}
      </div>
      ${(recipe.tags || []).length ? `<div class="detail-tags" aria-label="Recipe tags">${recipe.tags.map((tag) => `<span class="pill recipe-tag">${esc(tag)}</span>`).join('')}</div>` : ''}
    </div>
    <div class="detail-actions">
      <button class="action-button" data-copy="${esc(recipe.id)}">Copy shopping list</button>
      <button class="action-button" data-share="${esc(recipe.id)}">Copy recipe link</button>
      <button class="action-button made" data-made="${esc(recipe.id)}" ${recipe.madeByViewer ? 'disabled' : ''}>${recipe.madeByViewer ? 'You made this!' : 'I made this!'} · ${recipe.madeCount || 0}</button>
      ${sourceUrl ? `<a class="action-button source-link" href="${esc(sourceUrl)}" target="_blank" rel="noopener">Original recipe ↗</a>` : ''}
      <button class="action-button delete ${state.confirmDeleteId === recipe.id ? 'confirm' : ''}" data-delete="${esc(recipe.id)}">${state.confirmDeleteId === recipe.id ? 'Tap again to delete' : 'Delete recipe'}</button>
    </div>
    <div class="recipe-columns">
      <section><h3>What you need</h3><ul class="ingredient-list">${ingredients || '<li>Ingredients weren’t listed.</li>'}</ul></section>
      <section><h3>What to do</h3><ol class="steps">${steps || '<li>Instructions weren’t listed.</li>'}</ol></section>
    </div>
    ${socialTemplate(recipe)}`;
}

function openRecipe(id, updateHash = true) {
  const recipe = state.recipes.find((item) => item.id === id);
  if (!recipe) return;
  state.activeId = id;
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

function profileTemplate(profile) {
  const avatar = { ...AVATAR_DEFAULT, ...(profile.avatar || {}) };
  const backgrounds = [
    ['sunshine', 'Sunshine'], ['tomato', 'Tomato'], ['blueberry', 'Blueberry'], ['mint', 'Mint'],
  ];
  const accessories = [
    ['none', 'Just the bulb'], ['chef', 'Chef'], ['crown', 'Royal'], ['cowboy', 'Cowboy'], ['party', 'Party'],
  ];
  const badges = [
    ['spoon', 'Spoon'], ['heart', 'Heart'], ['fire', 'Spicy'], ['star', 'Star'],
  ];
  return `<div class="profile-hero">
      <div id="profile-avatar-preview" class="profile-avatar-preview">${avatarTemplate(profile, 'avatar-large')}</div>
      <div><span class="social-eyebrow">Your tiny sous-chef</span><h2>Make him yours</h2><p>This Recipeboy follows your ratings, reviews, and cooking victories around the shared box.</p></div>
    </div>
    <form id="profile-form" class="profile-form">
      <label class="profile-name">Display name<input name="displayName" maxlength="32" required value="${esc(profile.displayName || '')}"></label>
      <fieldset><legend>Backdrop</legend><div class="avatar-options">${backgrounds.map(([value, label]) => `<label class="avatar-option color-option avatar-${value}"><input type="radio" name="background" value="${value}" ${avatar.background === value ? 'checked' : ''}><span aria-hidden="true"></span><strong>${label}</strong></label>`).join('')}</div></fieldset>
      <fieldset><legend>Top it off</legend><div class="avatar-options">${accessories.map(([value, label]) => `<label class="avatar-option"><input type="radio" name="accessory" value="${value}" ${avatar.accessory === value ? 'checked' : ''}><span class="option-emoji" aria-hidden="true">${AVATAR_ACCESSORIES[value] || '✓'}</span><strong>${label}</strong></label>`).join('')}</div></fieldset>
      <fieldset><legend>Favorite flavor</legend><div class="avatar-options">${badges.map(([value, label]) => `<label class="avatar-option"><input type="radio" name="badge" value="${value}" ${avatar.badge === value ? 'checked' : ''}><span class="option-emoji" aria-hidden="true">${AVATAR_BADGES[value]}</span><strong>${label}</strong></label>`).join('')}</div></fieldset>
      <div class="profile-actions"><button class="primary-button" type="submit">Save my Recipeboy</button><button id="clerk-account-button" class="text-button" type="button">Account & sign-in settings</button></div>
    </form>`;
}

function renderAccountProfile() {
  if (!state.profile) return;
  el.accountAvatar.innerHTML = avatarTemplate(state.profile, 'avatar-account');
  el.accountLabel.textContent = state.profile.displayName;
}

function openProfile() {
  if (!state.profile) return;
  el.profileContent.innerHTML = profileTemplate(state.profile);
  el.profileDialog.showModal();
}

function profileFormAvatar(form) {
  const data = new FormData(form);
  return { background: data.get('background'), accessory: data.get('accessory'), badge: data.get('badge') };
}

function refreshProfilePreview() {
  const form = document.getElementById('profile-form');
  const preview = document.getElementById('profile-avatar-preview');
  if (!form || !preview) return;
  preview.innerHTML = avatarTemplate({ avatar: profileFormAvatar(form) }, 'avatar-large');
}

function replaceViewerProfile(profile) {
  for (const recipe of state.recipes) {
    recipe.makers = (recipe.makers || []).map((maker) => maker.isViewer ? { ...maker, ...profile } : maker);
    recipe.reviews = (recipe.reviews || []).map((review) => review.isViewer ? { ...review, ...profile } : review);
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
  if (!rating) return showToast('Tap a star first!');
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    Object.assign(recipe, await api(`/recipes/${encodeURIComponent(id)}/review`, { method: 'POST', body: JSON.stringify({ rating, review: data.get('review') }) }));
    render();
    refreshDialog();
    showToast(recipe.viewerReview ? 'Tasting note saved!' : 'Rating saved!');
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
    showToast(result.alreadyMade ? 'Recipeboy already counted you!' : (result.madeCount === 1 ? 'First cook! Legendary.' : `${result.madeCount} cooks and counting!`));
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
el.dialog.addEventListener('submit', saveReview);
document.getElementById('dialog-close').addEventListener('click', () => el.dialog.close());
el.dialog.addEventListener('click', (event) => { if (event.target === el.dialog) el.dialog.close(); });
el.dialog.addEventListener('close', () => {
  state.activeId = null;
  state.confirmDeleteId = null;
  if (location.hash.startsWith('#recipe=')) history.replaceState(null, '', `${location.pathname}${location.search}`);
});
el.search.addEventListener('input', () => { state.query = el.search.value; render(); });
el.sort.addEventListener('change', () => { state.sort = el.sort.value; render(); });
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
});

async function saveClippedRecipe() {
  const clippedRecipe = bookmarkletPayload();
  if (!clippedRecipe?.text) return;
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

async function loadSharedBox() {
  try {
    const result = await api('/recipes');
    state.recipes = result.recipes || [];
    render();
    const linkedRecipeId = recipeIdFromHash();
    if (linkedRecipeId) openRecipe(linkedRecipeId, false);
    await saveClippedRecipe();
  } catch (error) {
    el.count.textContent = error.message || 'Couldn’t reach the shared box';
    el.empty.hidden = false;
    el.empty.querySelector('h3').textContent = 'Recipeboy is taking a snack break.';
    el.empty.querySelector('p').textContent = 'Try refreshing or signing in again.';
  }
}

function showSignedOut() {
  loadedUserId = '';
  state.recipes = [];
  state.profile = null;
  if (el.dialog.open) el.dialog.close();
  el.appMain.hidden = true;
  el.authControls.hidden = true;
  el.bookmarkletDock.hidden = true;
  el.authGate.hidden = false;
  el.authMessage.textContent = 'Sign in to see and add recipes with your friends.';
  el.signIn.hidden = false;
}

async function showSignedIn(user) {
  el.authGate.hidden = true;
  el.appMain.hidden = false;
  el.authControls.hidden = false;
  el.accountLabel.textContent = user.label;
  el.account.title = 'Customize your Recipeboy';
  el.bookmarkletDock.hidden = bookmarkletWasDismissed();
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
  await loadSharedBox();
}

async function handleAuthChange(user) {
  if (user) await showSignedIn(user);
  else showSignedOut();
}

el.signIn.addEventListener('click', () => authClient?.signIn());
el.signOut.addEventListener('click', () => authClient?.signOut());
el.account.addEventListener('click', openProfile);
window.addEventListener('hashchange', () => {
  const linkedRecipeId = recipeIdFromHash();
  if (linkedRecipeId) {
    openRecipe(linkedRecipeId, false);
  } else if (el.dialog.open) {
    el.dialog.close();
  }
});

try {
  authClient = await initAuth({ onChange: (user) => { void handleAuthChange(user); } });
  await handleAuthChange(authClient.user);
} catch (error) {
  el.authMessage.textContent = `${error.message} Refresh the page to try again.`;
  el.signIn.hidden = true;
}
