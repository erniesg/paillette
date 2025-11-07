# Deployment Workflow

## Branch Strategy

```
dev (local development)
  ↓
staging (paillette-stg.workers.dev)
  ↓
master/main (paillette.workers.dev)
```

## Environments

| Environment | Branch | Worker Name | URL | Purpose |
|-------------|--------|-------------|-----|---------|
| **Development** | `dev` | N/A | `localhost:8787` | Local development with `wrangler dev` |
| **Staging** | `staging` | `paillette-stg` | `paillette-stg.workers.dev` | Testing before production |
| **Production** | `master` | `paillette` | `paillette.workers.dev` | Live production environment |

## Deployment Commands

### Local Development (dev branch)
```bash
git checkout dev
cd apps/api
pnpm dev  # Runs wrangler dev on localhost:8787
```

### Deploy to Staging
```bash
git checkout staging
git merge dev  # Or merge feature branches
cd apps/api
pnpm wrangler deploy --env staging  # Deploys to paillette-stg.workers.dev
```

### Deploy to Production
```bash
git checkout master
git merge staging  # Only merge tested staging code
cd apps/api
pnpm wrangler deploy --env production  # Deploys to paillette.workers.dev
```

## Infrastructure Setup

### Staging Environment

```bash
# D1 Database
wrangler d1 create paillette-db-staging

# R2 Bucket
wrangler r2 bucket create paillette-images-staging

# Vectorize Index (1024 dimensions for Jina CLIP v2)
wrangler vectorize create artwork-embeddings-staging \
  --dimensions=1024 \
  --metric=cosine

# KV Namespace
wrangler kv:namespace create CACHE --env staging

# Queue
wrangler queues create embedding-jobs-staging

# Secrets
wrangler secret put REPLICATE_API_KEY --env staging
```

### Production Environment

```bash
# D1 Database
wrangler d1 create paillette-db

# R2 Bucket
wrangler r2 bucket create paillette-images

# Vectorize Index
wrangler vectorize create artwork-embeddings \
  --dimensions=1024 \
  --metric=cosine

# KV Namespace
wrangler kv:namespace create CACHE --env production

# Queue
wrangler queues create embedding-jobs

# Secrets
wrangler secret put REPLICATE_API_KEY --env production
```

## Database Migrations

### Apply to Staging
```bash
cd apps/api
wrangler d1 execute paillette-db-staging \
  --env staging \
  --file=../../packages/database/migrations/0001_initial_schema.sql
```

### Apply to Production
```bash
cd apps/api
wrangler d1 execute paillette-db \
  --env production \
  --file=../../packages/database/migrations/0001_initial_schema.sql
```

## Update wrangler.toml IDs

After creating resources, update `apps/api/wrangler.toml` with the IDs:

1. Run `wrangler d1 list` and copy staging/production database IDs
2. Run `wrangler kv:namespace list` and copy KV namespace IDs
3. Update the corresponding `database_id` and `id` fields in wrangler.toml

## Workflow Example

```bash
# 1. Develop feature locally
git checkout dev
# ... make changes ...
pnpm dev  # Test locally

# 2. Commit and push to dev
git add .
git commit -m "feat: add new feature"
git push origin dev

# 3. Merge to staging for testing
git checkout staging
git merge dev
git push origin staging
cd apps/api
pnpm wrangler deploy --env staging

# 4. Test on paillette-stg.workers.dev
curl https://paillette-stg.workers.dev/api/v1/health

# 5. If tests pass, promote to production
git checkout master
git merge staging
git push origin master
cd apps/api
pnpm wrangler deploy --env production

# 6. Verify production
curl https://paillette.workers.dev/api/v1/health
```

## CI/CD (Future)

GitHub Actions will automate:
- `staging` branch → auto-deploy to `paillette-stg.workers.dev`
- `master` branch → auto-deploy to `paillette.workers.dev`
- PRs → run tests and type checking

## Notes

- **Never deploy directly to production** without testing in staging first
- Staging has separate resources (database, storage, queues) to prevent conflicts
- Production deployments should only come from the `master` branch
- Use `.dev.vars` for local secrets (never commit this file)
