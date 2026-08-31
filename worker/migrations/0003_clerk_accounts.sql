ALTER TABLE recipes ADD COLUMN created_by_user_id TEXT;

CREATE TABLE IF NOT EXISTS recipe_makes (
  recipe_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (recipe_id, user_id)
);

CREATE INDEX IF NOT EXISTS recipe_makes_user_id ON recipe_makes(user_id);
