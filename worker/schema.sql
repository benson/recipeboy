CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source_url TEXT,
  source_name TEXT,
  data_json TEXT NOT NULL,
  made_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  created_by_user_id TEXT
);

CREATE TABLE IF NOT EXISTS recipe_makes (
  recipe_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (recipe_id, user_id)
);

CREATE INDEX IF NOT EXISTS recipes_created_at ON recipes(created_at DESC);
CREATE INDEX IF NOT EXISTS recipes_active_created_at ON recipes(deleted_at, created_at DESC);
CREATE INDEX IF NOT EXISTS recipe_makes_user_id ON recipe_makes(user_id);
