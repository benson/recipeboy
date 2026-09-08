export function initPhotoViewer({ getRecipe, canDelete, photoUrl, deletePhoto }) {
  const dialog = document.getElementById('photo-dialog');
  const image = document.getElementById('photo-viewer-image');
  const title = document.getElementById('photo-viewer-title');
  const caption = document.getElementById('photo-viewer-caption');
  const position = document.getElementById('photo-viewer-position');
  const previous = document.getElementById('photo-previous');
  const next = document.getElementById('photo-next');
  const options = document.getElementById('photo-options');
  const confirmation = document.getElementById('photo-delete-dialog');
  const confirmButton = document.getElementById('photo-delete-confirm');
  const cancelButton = document.getElementById('photo-delete-cancel');
  const error = document.getElementById('photo-delete-error');
  let recipeId = null;
  let photoId = null;
  let opener = null;
  let deleting = false;

  function current() {
    const recipe = getRecipe(recipeId);
    const photos = recipe?.photos || [];
    return { recipe, photos, index: photos.findIndex((photo) => photo.id === photoId) };
  }

  function render() {
    const { recipe, photos, index } = current();
    if (index < 0) { dialog.close(); return; }
    const photo = photos[index];
    title.textContent = recipe.title;
    image.src = photoUrl(photo);
    image.alt = `Photo of ${recipe.title}${photo.addedBy?.displayName ? ` by ${photo.addedBy.displayName}` : ''}`;
    caption.textContent = photo.addedBy?.displayName ? `Photo by ${photo.addedBy.displayName}` : 'From a Recipeboy friend';
    position.textContent = `${index + 1} of ${photos.length}`;
    previous.hidden = next.hidden = photos.length < 2;
    options.hidden = !canDelete();
    options.open = false;
  }

  function move(direction) {
    const { photos, index } = current();
    if (photos.length < 2) return;
    photoId = photos[(index + direction + photos.length) % photos.length].id;
    render();
  }

  function close() {
    if (deleting) return;
    confirmation.close();
    dialog.close();
  }

  document.getElementById('photo-close').addEventListener('click', close);
  previous.addEventListener('click', () => move(-1));
  next.addEventListener('click', () => move(1));
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
    if (!options.contains(event.target)) options.open = false;
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && options.open) {
      event.preventDefault();
      options.open = false;
      options.querySelector('summary').focus();
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      move(event.key === 'ArrowLeft' ? -1 : 1);
    }
  });
  dialog.addEventListener('close', () => {
    options.open = false;
    image.removeAttribute('src');
    // Saving a deletion redraws the gallery, so its original button may be gone.
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    else {
      const parent = document.getElementById('recipe-dialog');
      const target = parent.open ? parent.querySelector('#dialog-close') : document.getElementById('search');
      target?.focus({ preventScroll: true });
    }
    recipeId = photoId = null;
  });

  document.getElementById('photo-delete-request').addEventListener('click', () => {
    if (!canDelete()) return;
    options.open = false;
    error.hidden = true;
    confirmation.showModal();
    cancelButton.focus();
  });
  cancelButton.addEventListener('click', () => confirmation.close());
  confirmation.addEventListener('click', (event) => {
    if (event.target === confirmation && !deleting) confirmation.close();
  });
  confirmation.addEventListener('cancel', (event) => { if (deleting) event.preventDefault(); });
  confirmation.addEventListener('close', () => {
    if (dialog.open) options.querySelector('summary').focus({ preventScroll: true });
  });
  confirmButton.addEventListener('click', async () => {
    if (deleting || !canDelete()) return;
    const { index } = current();
    if (index < 0) return;
    deleting = true;
    confirmButton.disabled = cancelButton.disabled = true;
    confirmButton.textContent = 'Deleting…';
    error.hidden = true;
    try {
      await deletePhoto(recipeId, photoId);
      const photos = getRecipe(recipeId)?.photos || [];
      confirmation.close();
      if (photos.length) {
        photoId = photos[Math.min(index, photos.length - 1)].id;
        render();
        document.getElementById('photo-close').focus();
      } else dialog.close();
    } catch (failure) {
      error.textContent = failure.message || 'Could not delete this photo. Please try again.';
      error.hidden = false;
    } finally {
      deleting = false;
      confirmButton.disabled = cancelButton.disabled = false;
      confirmButton.textContent = 'Delete photo';
    }
  });

  return {
    open(id, selectedPhotoId, trigger) {
      recipeId = id;
      photoId = selectedPhotoId;
      opener = trigger;
      if (current().index < 0) return;
      render();
      if (!dialog.open) dialog.showModal();
      document.getElementById('photo-close').focus();
    },
    close,
  };
}
