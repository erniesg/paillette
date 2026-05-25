-- Migration: Move NGS public org IDs away from zero-series UUIDs
-- Created: 2026-05-25

PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

-- New stable UUIDv4 identifiers. The `ngs` key and slug remain the public API
-- identifiers; this only changes internal UUID storage.
UPDATE org_users
SET org_id = 'cf98791d-f3cc-4f9f-b40c-a350efadbd05'
WHERE org_id = '00000000-0000-4000-8000-000000000101';

UPDATE collections
SET org_id = 'cf98791d-f3cc-4f9f-b40c-a350efadbd05'
WHERE org_id = '00000000-0000-4000-8000-000000000101';

UPDATE artworks
SET org_id = 'cf98791d-f3cc-4f9f-b40c-a350efadbd05'
WHERE org_id = '00000000-0000-4000-8000-000000000101';

UPDATE assets
SET org_id = 'cf98791d-f3cc-4f9f-b40c-a350efadbd05'
WHERE org_id = '00000000-0000-4000-8000-000000000101';

UPDATE upload_jobs
SET org_id = 'cf98791d-f3cc-4f9f-b40c-a350efadbd05'
WHERE org_id = '00000000-0000-4000-8000-000000000101';

UPDATE api_usage_events
SET org_id = 'cf98791d-f3cc-4f9f-b40c-a350efadbd05'
WHERE org_id = '00000000-0000-4000-8000-000000000101';

UPDATE artwork_usage_events
SET org_id = 'cf98791d-f3cc-4f9f-b40c-a350efadbd05'
WHERE org_id = '00000000-0000-4000-8000-000000000101';

UPDATE artworks
SET collection_id = '47ad207e-9962-4742-8c54-d8bbdddb4f0f'
WHERE collection_id = '00000000-0000-4000-8000-000000000201';

DELETE FROM collection_artworks
WHERE collection_id = '00000000-0000-4000-8000-000000000201'
  AND EXISTS (
    SELECT 1
    FROM collection_artworks existing
    WHERE existing.collection_id = '47ad207e-9962-4742-8c54-d8bbdddb4f0f'
      AND existing.artwork_id = collection_artworks.artwork_id
  );

UPDATE collection_artworks
SET collection_id = '47ad207e-9962-4742-8c54-d8bbdddb4f0f'
WHERE collection_id = '00000000-0000-4000-8000-000000000201';

UPDATE collections
SET id = '47ad207e-9962-4742-8c54-d8bbdddb4f0f'
WHERE id = '00000000-0000-4000-8000-000000000201'
  AND NOT EXISTS (
    SELECT 1
    FROM collections
    WHERE id = '47ad207e-9962-4742-8c54-d8bbdddb4f0f'
  );

DELETE FROM collections
WHERE id = '00000000-0000-4000-8000-000000000201'
  AND EXISTS (
    SELECT 1
    FROM collections
    WHERE id = '47ad207e-9962-4742-8c54-d8bbdddb4f0f'
  );

UPDATE orgs
SET id = 'cf98791d-f3cc-4f9f-b40c-a350efadbd05'
WHERE id = '00000000-0000-4000-8000-000000000101'
  AND NOT EXISTS (
    SELECT 1
    FROM orgs
    WHERE id = 'cf98791d-f3cc-4f9f-b40c-a350efadbd05'
  );

DELETE FROM orgs
WHERE id = '00000000-0000-4000-8000-000000000101'
  AND EXISTS (
    SELECT 1
    FROM orgs
    WHERE id = 'cf98791d-f3cc-4f9f-b40c-a350efadbd05'
  );

COMMIT;

PRAGMA foreign_keys = ON;
