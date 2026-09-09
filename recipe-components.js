// Recipes stay independent: a meal stores ordered references, never copies.
export const MAX_COMPONENTS = 16;

export function componentIds(recipe) {
  return Array.isArray(recipe?.componentRecipeIds)
    ? [...new Set(recipe.componentRecipeIds.filter((id) => typeof id === 'string' && id))]
    : [];
}

export function reachesRecipe(startId, targetId, recipes) {
  const byId = recipes instanceof Map ? recipes : new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const seen = new Set();
  const pending = [startId];
  while (pending.length) {
    const id = pending.pop();
    if (id === targetId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    pending.push(...componentIds(byId.get(id)));
  }
  return false;
}

export function validateComponentIds(value, recipeId, recipes, previousIds = []) {
  if (!Array.isArray(value) || value.length > MAX_COMPONENTS || value.some((id) => typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(id))) {
    throw new Error(`Choose up to ${MAX_COMPONENTS} recipes to link.`);
  }
  const ids = [...new Set(value)];
  const byId = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  for (const id of ids) {
    const target = byId.get(id);
    // Existing links survive soft deletion and work again after restoration.
    if ((!target || target.deletedAt) && !previousIds.includes(id)) throw new Error('A linked recipe is unavailable. Refresh the recipe box and choose again.');
    if (reachesRecipe(id, recipeId, byId)) throw new Error('Recipes cannot link back to themselves, even through another recipe.');
  }
  return ids;
}

// One batch per distinct recipe, even if a nested meal shares a component.
// Missing references remain explicit so copying never silently drops groceries.
export function shoppingGroups(root, recipes) {
  const byId = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const seen = new Set();
  const groups = [];
  function visit(recipe, id = recipe?.id) {
    if (seen.has(id)) return;
    seen.add(id);
    if (!recipe) { groups.push({ id, missing: true }); return; }
    groups.push(recipe);
    for (const childId of componentIds(recipe)) visit(byId.get(childId), childId);
  }
  visit(root);
  return groups;
}
