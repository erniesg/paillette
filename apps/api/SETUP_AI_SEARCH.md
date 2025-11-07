# AI Search Setup Guide

Quick start guide for setting up AI-powered image similarity search in Paillette.

## Prerequisites

1. Cloudflare account with Workers enabled
2. Replicate account (free tier available)
3. Wrangler CLI installed

## Step 1: Create Replicate API Key

1. Go to https://replicate.com/account/api-tokens
2. Click "Create token"
3. Copy your API key (starts with `r8_`)

## Step 2: Configure Environment

### Local Development

Create `.dev.vars` in `apps/api/`:

```env
REPLICATE_API_KEY=r8_your_api_key_here
ENVIRONMENT=development
API_VERSION=v1
```

### Production

Add to Cloudflare Dashboard:
```bash
wrangler secret put REPLICATE_API_KEY
# Paste your API key when prompted
```

## Step 3: Create Vectorize Index

```bash
# Navigate to API directory
cd apps/api

# Create index for Jina CLIP v2 embeddings (1024 dimensions)
wrangler vectorize create artwork-embeddings \
  --dimensions=1024 \
  --metric=cosine

# Verify index was created
wrangler vectorize list
```

**Expected Output:**
```
┌─────────────────────┬────────┬──────────┬──────┐
│ name                │ metric │ dimensions│ count│
├─────────────────────┼────────┼──────────┼──────┤
│ artwork-embeddings  │ cosine │ 1024     │ 0    │
└─────────────────────┴────────┴──────────┴──────┘
```

## Step 4: Update Wrangler Config

Verify `wrangler.toml` has correct index name:

```toml
[[vectorize]]
binding = "VECTORIZE"
index_name = "artwork-embeddings"  # Match the name from Step 3
```

## Step 5: Deploy

```bash
# Test locally first
npm run dev

# Deploy to production
npm run deploy
```

## Step 6: Test the Integration

### 1. Upload Test Artwork

```bash
curl -X POST http://localhost:8787/api/v1/artworks/upload \
  -F "image=@test-artwork.jpg" \
  -F 'metadata={"gallery_id":"test-gallery-id","title":"Test Artwork"}'
```

### 2. Check Search Health

```bash
curl http://localhost:8787/api/v1/search/health
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "vectorize": {
      "connected": true,
      "dimensions": 1024,
      "count": 1
    },
    "workers_ai": {
      "connected": true
    },
    "replicate": {
      "configured": true
    }
  }
}
```

### 3. Test Similarity Search

```bash
curl -X POST http://localhost:8787/api/v1/search/similar \
  -H "Content-Type: application/json" \
  -d '{
    "imageUrl": "https://example.com/artwork.jpg",
    "topK": 5
  }'
```

### 4. Test Text Search

```bash
curl -X POST http://localhost:8787/api/v1/search/text \
  -H "Content-Type: application/json" \
  -d '{
    "query": "impressionist landscape painting",
    "topK": 5
  }'
```

## Step 7: Monitor Queue Processing

```bash
# View queue stats
wrangler queues list

# Monitor logs in real-time
wrangler tail

# Check for failed embeddings
wrangler d1 execute paillette-db \
  --command "SELECT id, title FROM artworks WHERE embedding_id IS NULL"
```

## Troubleshooting

### Issue: "REPLICATE_API_KEY not configured"

**Solution:**
```bash
# Check if secret exists
wrangler secret list

# If missing, add it
wrangler secret put REPLICATE_API_KEY
```

### Issue: "Vectorize index not found"

**Solution:**
```bash
# List indexes to verify name
wrangler vectorize list

# Update wrangler.toml with correct name
# OR create new index with correct name
```

### Issue: Embeddings not being generated

**Solution:**
```bash
# Check queue consumer is running
wrangler tail --format pretty

# Look for queue processing logs
# Should see: "Processing batch of X embedding jobs"

# Manually trigger batch embedding
curl -X POST http://localhost:8787/api/v1/search/batch-embed \
  -H "Content-Type: application/json" \
  -d '{
    "artworkIds": ["artwork-id-1", "artwork-id-2"]
  }'
```

### Issue: Slow embedding generation

**Causes:**
- Cold start on Replicate (first request: ~5s)
- Large image size (resize to 1024×1024 max)
- High queue backlog

**Solutions:**
- Warm up Replicate by keeping predictions active
- Optimize image sizes before upload
- Increase queue batch size in wrangler.toml

### Issue: Search returning no results

**Checklist:**
1. Verify embeddings exist: `SELECT COUNT(*) FROM artworks WHERE embedding_id IS NOT NULL`
2. Check Vectorize count: `wrangler vectorize get artwork-embeddings`
3. Lower `minScore` threshold (try 0.3 instead of 0.5)
4. Verify filter parameters match actual data

## Configuration Options

### Adjust Embedding Model

To switch to SigLIP (768d, cheaper):

1. Update Vectorize index:
```bash
wrangler vectorize create artwork-embeddings-siglip \
  --dimensions=768 \
  --metric=cosine
```

2. Update `apps/api/src/utils/embedding.ts`:
```typescript
export const DEFAULT_CONFIG: EmbeddingConfig = SIGLIP_CONFIG;
```

3. Update wrangler.toml:
```toml
[[vectorize]]
binding = "VECTORIZE"
index_name = "artwork-embeddings-siglip"
```

### Adjust Queue Settings

Edit `wrangler.toml`:

```toml
[[queues.consumers]]
queue = "embedding-jobs"
max_batch_size = 20        # Process more at once
max_batch_timeout = 60     # Wait longer for full batch
max_retries = 5            # Retry more times
```

## Cost Optimization

### Reduce Replicate Costs

1. **Batch embeddings** instead of real-time:
```javascript
// Queue all uploads, process in batch at night
cron.schedule('0 2 * * *', async () => {
  await processPendingEmbeddings();
});
```

2. **Use thumbnail for embeddings** (faster, cheaper):
```javascript
// Generate embedding from thumbnail (smaller file)
const thumbnailUrl = artwork.thumbnail_url;
await generateImageEmbedding(thumbnailUrl, config);
```

### Reduce Vectorize Costs

1. **Lower dimensions** (768d vs 1024d = 25% savings)
2. **Implement caching** for frequent searches
3. **Use namespaces** for gallery isolation

## Performance Tuning

### Enable Caching

```typescript
// Cache frequent text searches
const cacheKey = `search:${query}`;
const cached = await env.CACHE.get(cacheKey);

if (cached) {
  return JSON.parse(cached);
}

const results = await searchArtworksByText(...);

await env.CACHE.put(cacheKey, JSON.stringify(results), {
  expirationTtl: 3600 // 1 hour
});
```

### Optimize Metadata Filtering

```typescript
// Create indexes on frequently filtered fields
// In Vectorize, limit to 10 most important filters
const metadata = {
  galleryId: artwork.gallery_id,    // Always index
  artist: artwork.artist,            // High-cardinality, index
  year: artwork.year,                // Range queries, index
  medium: artwork.medium,            // Common filter, index
  // ... up to 6 more fields
};
```

## Migration to Production

### Pre-deployment Checklist

- [ ] REPLICATE_API_KEY secret configured
- [ ] Vectorize index created
- [ ] D1 database initialized
- [ ] R2 bucket created with public access
- [ ] Queue consumer tested
- [ ] Sample embeddings generated
- [ ] Search endpoints tested
- [ ] Error handling verified
- [ ] Monitoring configured

### Deploy

```bash
# Deploy to staging first
wrangler deploy --env staging

# Test staging
curl https://paillette-api-staging.workers.dev/api/v1/search/health

# Deploy to production
wrangler deploy --env production
```

### Post-deployment

1. Monitor logs: `wrangler tail --env production`
2. Check error rates in Cloudflare Dashboard
3. Verify embedding queue is processing
4. Test search from production UI

## Next Steps

Once setup is complete:

1. **Optimize search UX**: Add "More Like This" buttons
2. **Implement recommendations**: Use embeddings for discovery
3. **Add filters**: Expose metadata filters in UI
4. **Monitor performance**: Set up analytics
5. **Scale**: Plan migration to Qdrant for >5M artworks

## Resources

- [AI Search API Docs](./AI_SEARCH_API.md)
- [Artwork API Docs](./ARTWORK_API.md)
- [Cloudflare Vectorize Docs](https://developers.cloudflare.com/vectorize/)
- [Replicate Docs](https://replicate.com/docs)
- [Jina CLIP v2 Model](https://huggingface.co/jinaai/jina-clip-v2)
