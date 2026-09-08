-- Apply once before deploying the recovery API. Existing photos stay active.
ALTER TABLE recipe_photos ADD COLUMN deleted_at TEXT;

CREATE TABLE IF NOT EXISTS deleted_items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('list', 'review')),
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  data_json TEXT NOT NULL,
  deleted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS deleted_items_user_id ON deleted_items(user_id, deleted_at DESC);
