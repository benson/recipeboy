CREATE TABLE IF NOT EXISTS recipe_photos (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS recipe_photos_recipe_id ON recipe_photos(recipe_id, created_at DESC);
CREATE INDEX IF NOT EXISTS recipe_photos_user_id ON recipe_photos(user_id);
