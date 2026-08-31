ALTER TABLE recipes ADD COLUMN deleted_at TEXT;
CREATE INDEX IF NOT EXISTS recipes_active_created_at ON recipes(deleted_at, created_at DESC);
