export function recipePath(id) {
  return `/recipe/${encodeURIComponent(id)}`;
}

export function recipeIdFromUrl(value) {
  const url = new URL(value);
  return url.pathname.match(/^\/recipe\/([a-zA-Z0-9-]{1,100})\/?$/)?.[1]
    || url.hash.match(/^#recipe=([a-zA-Z0-9-]{1,100})$/)?.[1]
    || '';
}
