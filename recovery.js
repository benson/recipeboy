export function initRecovery({ api, onRestore }) {
  const dialog = document.getElementById('recovery-dialog');
  const list = document.getElementById('recovery-items');
  const status = document.getElementById('recovery-status');
  let items = [];
  let loading = false;

  async function load() {
    status.textContent = 'Looking in the cupboard…';
    const result = await api('/trash');
    items = result.items;
    list.replaceChildren();
    for (const item of items) {
      const row = document.createElement('li');
      const info = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = item.title;
      const detail = document.createElement('span');
      const kind = { recipe: 'Recipe', photo: 'Meal photo', list: 'Your list', review: 'Your review' }[item.kind];
      detail.textContent = `${kind} · ${new Date(item.deletedAt).toLocaleDateString()}${item.needsRecipe ? ' · Restore the recipe first' : ''}`;
      info.append(title, detail);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'action-button';
      button.textContent = 'Restore';
      button.setAttribute('aria-label', `Restore ${kind.toLowerCase()}: ${item.title}`);
      button.disabled = Boolean(item.needsRecipe);
      button.addEventListener('click', () => { void restore(item, button); });
      row.append(info, button);
      list.append(row);
    }
    status.textContent = items.length ? '' : 'Nothing deleted. Everything is in its place.';
  }

  async function restore(item, button) {
    if (loading) return;
    loading = true;
    button.disabled = true;
    button.textContent = 'Restoring…';
    try {
      const recipePath = `/recipes/${encodeURIComponent(item.recipeId || item.id)}`;
      const path = item.kind === 'recipe' ? `${recipePath}/restore`
        : item.kind === 'photo' ? `${recipePath}/photos/${encodeURIComponent(item.id)}/restore`
        : `/trash/${encodeURIComponent(item.id)}/restore`;
      await api(path, { method: 'POST' });
      await onRestore();
      await load();
      status.textContent = `Restored “${item.title}”.${items.length ? '' : ' Everything is back in its place.'}`;
      document.getElementById('recovery-close').focus();
    } catch (error) {
      status.textContent = error.message || 'Could not restore this item. Please try again.';
      button.disabled = false;
      button.textContent = 'Restore';
    } finally { loading = false; }
  }

  document.getElementById('recovery-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  return {
    async open() {
      list.replaceChildren();
      if (!dialog.open) dialog.showModal();
      try { await load(); }
      catch (error) { status.textContent = error.message || 'Could not load deleted items. Please try again.'; }
    },
    close() { dialog.close(); },
  };
}
