CREATE TABLE IF NOT EXISTS recipe_lists (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recipe_list_items (
  list_id TEXT NOT NULL,
  recipe_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (list_id, recipe_id)
);

CREATE INDEX IF NOT EXISTS recipe_lists_user_id ON recipe_lists(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS recipe_list_items_recipe_id ON recipe_list_items(recipe_id);
