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

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  avatar_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recipe_reviews (
  recipe_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (recipe_id, user_id)
);

CREATE INDEX IF NOT EXISTS recipe_reviews_recipe_id ON recipe_reviews(recipe_id);
CREATE INDEX IF NOT EXISTS recipe_reviews_user_id ON recipe_reviews(user_id);
