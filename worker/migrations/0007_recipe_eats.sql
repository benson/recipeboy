-- Eating and cooking are independent. Preserve all existing cooking records.
CREATE TABLE IF NOT EXISTS recipe_eats (
  recipe_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (recipe_id, user_id)
);
CREATE INDEX IF NOT EXISTS recipe_eats_user_id ON recipe_eats(user_id);

-- Leave historical reviews unclassified rather than guessing their perspective.
ALTER TABLE recipe_reviews ADD COLUMN experience TEXT CHECK (experience IN ('cooked', 'ate'));
