import { componentIds, reachesRecipe, MAX_COMPONENTS } from './recipe-components.js?v=1';

const esc = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

export function componentPickerTemplate(recipe = {}) {
  return `<fieldset class="component-picker" data-component-picker data-parent-id="${esc(recipe.id || '')}">
    <legend>Made with other recipes</legend>
    <p>Build a meal from recipes in the box. Each keeps its own link. Use one batch of each; the shopping list includes them all.</p>
    <ol class="component-selection">${componentIds(recipe).map((id) => `<li><input type="hidden" name="componentRecipeIds" value="${esc(id)}"></li>`).join('')}</ol>
    <label class="component-search-label">Find a recipe to link<input type="search" data-component-search placeholder="Search the recipe box" autocomplete="off"></label>
    <div class="component-results"></div>
    <span class="component-picker-status" role="status"></span>
  </fieldset>`;
}

export function selectedComponentIds(root) {
  return [...root.querySelectorAll('input[name="componentRecipeIds"]')].map((input) => input.value);
}

export function initComponentPicker(root, getRecipes) {
  if (!root) return;
  const selection = root.querySelector('.component-selection');
  const results = root.querySelector('.component-results');
  const search = root.querySelector('[data-component-search]');
  const status = root.querySelector('.component-picker-status');
  let ids = selectedComponentIds(root);

  function renderSelection() {
    const recipes = getRecipes();
    selection.innerHTML = ids.map((id, index) => {
      const title = recipes.find((recipe) => recipe.id === id)?.title || 'Unavailable recipe (link kept for restoration)';
      return `<li><input type="hidden" name="componentRecipeIds" value="${esc(id)}"><span>${esc(title)}</span><div class="component-order">
        <button type="button" data-component-up="${esc(id)}" aria-label="Move ${esc(title)} up" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" data-component-down="${esc(id)}" aria-label="Move ${esc(title)} down" ${index === ids.length - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" data-component-remove="${esc(id)}" aria-label="Unlink ${esc(title)}">×</button>
      </div></li>`;
    }).join('');
    selection.hidden = !ids.length;
  }

  function renderResults() {
    const recipes = getRecipes();
    const query = search.value.trim().toLowerCase();
    const matches = recipes.filter((recipe) => !ids.includes(recipe.id)
      && (!root.dataset.parentId || !reachesRecipe(recipe.id, root.dataset.parentId, recipes))
      && recipe.title.toLowerCase().includes(query));
    results.innerHTML = matches.slice(0, 6).map((recipe) => `<button type="button" data-component-add="${esc(recipe.id)}" ${ids.length >= MAX_COMPONENTS ? 'disabled' : ''}><span>${esc(recipe.title)}</span><span aria-hidden="true">＋</span></button>`).join('');
    status.textContent = ids.length >= MAX_COMPONENTS ? `Limit of ${MAX_COMPONENTS} linked recipes reached.`
      : matches.length > 6 ? `${matches.length} recipes available. Search to narrow the list.`
      : !matches.length ? 'No matching recipes available to link.' : '';
  }

  search.addEventListener('input', renderResults);
  root.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if (button.dataset.componentAdd && ids.length < MAX_COMPONENTS) {
      ids.push(button.dataset.componentAdd);
    } else if (button.dataset.componentRemove) {
      ids = ids.filter((id) => id !== button.dataset.componentRemove);
    } else {
      const id = button.dataset.componentUp || button.dataset.componentDown;
      const index = ids.indexOf(id);
      const next = index + (button.dataset.componentUp ? -1 : 1);
      if (index < 0 || next < 0 || next >= ids.length) return;
      [ids[index], ids[next]] = [ids[next], ids[index]];
    }
    renderSelection();
    renderResults();
    search.focus({ preventScroll: true });
  });
  renderSelection();
  renderResults();
}
