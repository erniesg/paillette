-- The legacy orgs.api_key column is NOT NULL and UNIQUE, but organization
-- authentication uses the separately hashed personal api_keys table. Retain
-- the column as a stable, non-secret identifier while removing raw keys.
-- This assignment is deterministic, so safely reapplying it does not alter
-- hashes, owners, personal API keys, or already-retired values.
UPDATE orgs
SET api_key = 'retired-org-key:' || id;
