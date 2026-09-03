-- Reviewed metadata backfill, 2026-09-03. Update metadata only; preserve recipe
-- text, authors, reviews, photos, and participation. Expected-value guards make
-- this safe to rerun and avoid overwriting a friend's intervening edits.
-- Approximate values are explicitly marked for the UI (see README).

UPDATE recipes SET data_json = json_set(data_json,
  '$.yield', '4 servings', '$.metadataEstimates', json('["yield"]'))
WHERE id = '7c1c3fdb-9c5' AND deleted_at IS NULL
  AND json_extract(data_json, '$.yield') = 'Serves: 0';

UPDATE recipes SET data_json = json_set(data_json,
  '$.prepMinutes', 10, '$.cookMinutes', 20, '$.totalMinutes', 30,
  '$.metadataEstimates', json('["prepMinutes","cookMinutes","totalMinutes"]'))
WHERE id = '24ce04c8-975' AND deleted_at IS NULL
  AND json_extract(data_json, '$.prepMinutes') = 0
  AND json_extract(data_json, '$.cookMinutes') = 0
  AND json_extract(data_json, '$.totalMinutes') = 0;

UPDATE recipes SET data_json = json_set(data_json,
  '$.yield', '6 servings', '$.prepMinutes', 20, '$.cookMinutes', 50, '$.totalMinutes', 70,
  '$.metadataEstimates', json('["prepMinutes","cookMinutes","totalMinutes"]'))
WHERE id = 'a2aadd90-0ad' AND deleted_at IS NULL
  AND json_extract(data_json, '$.yield') = '6'
  AND json_extract(data_json, '$.prepMinutes') = 0
  AND json_extract(data_json, '$.cookMinutes') = 0
  AND json_extract(data_json, '$.totalMinutes') = 0;

UPDATE recipes SET data_json = json_set(data_json,
  '$.yield', '4–6 servings', '$.prepMinutes', 20, '$.cookMinutes', 40, '$.totalMinutes', 60,
  '$.metadataEstimates', json('["yield","prepMinutes","cookMinutes","totalMinutes"]'))
WHERE id = '7a2ccef0-34c' AND deleted_at IS NULL
  AND json_extract(data_json, '$.yield') = '0'
  AND json_extract(data_json, '$.prepMinutes') = 0
  AND json_extract(data_json, '$.cookMinutes') = 0
  AND json_extract(data_json, '$.totalMinutes') = 0;

UPDATE recipes SET data_json = json_set(data_json,
  '$.prepMinutes', 45, '$.cookMinutes', 85, '$.totalMinutes', 330,
  '$.metadataEstimates', json('["prepMinutes","cookMinutes","totalMinutes"]'))
WHERE id = '02f08f2c-80d' AND deleted_at IS NULL
  AND json_extract(data_json, '$.prepMinutes') = 0
  AND json_extract(data_json, '$.cookMinutes') = 0
  AND json_extract(data_json, '$.totalMinutes') = 0;

UPDATE recipes SET data_json = json_set(data_json, '$.yield', '4 servings')
WHERE id = '021df416-905' AND deleted_at IS NULL
  AND json_extract(data_json, '$.yield') = '4';

-- The legacy total was 2, but only Benson has a per-person cook record.
-- Do not remove history or change any other recipe's count.
UPDATE recipes SET made_count = 1
WHERE id = 'c343222b-c8c' AND deleted_at IS NULL AND made_count = 2
  AND (SELECT COUNT(*) FROM recipe_makes WHERE recipe_id = recipes.id) = 1
  AND EXISTS (SELECT 1 FROM recipe_makes
    WHERE recipe_id = recipes.id AND user_id = 'user_3IhZjzmUHOoMbaqunIrcAl3cjec');
