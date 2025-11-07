# AI-Powered Search API

## Overview

The AI-Powered Search API provides semantic image and text search capabilities using state-of-the-art embedding models and Cloudflare Vectorize for efficient similarity search.

## Architecture

```
┌────────────────────────────────────────────────────────┐
│                  Artwork Upload                        │
└─────────────┬──────────────────────────────────────────┘
              │
              ▼
┌────────────────────────────────────────────────────────┐
│        R2 Storage (Image Hosting)                      │
└─────────────┬──────────────────────────────────────────┘
              │
              ▼
┌────────────────────────────────────────────────────────┐
│     Embedding Queue (Async Processing)                 │
└─────────────┬──────────────────────────────────────────┘
              │
              ▼
┌────────────────────────────────────────────────────────┐
│  Replicate API (Jina CLIP v2 - 1024d)                 │
│  - 512×512 resolution                                  │
│  - Multilingual (89 languages)                         │
│  - State-of-the-art retrieval                          │
└─────────────┬──────────────────────────────────────────┘
              │
              ▼
┌────────────────────────────────────────────────────────┐
│  Cloudflare Vectorize (Vector Storage)                 │
│  - Up to 5M vectors per index                          │
│  - Max 1536 dimensions                                 │
│  - Metadata filtering                                  │
└─────────────┬──────────────────────────────────────────┘
              │
              ▼
┌────────────────────────────────────────────────────────┐
│           Similarity Search API                        │
│  - Image-to-image search                               │
│  - Text-to-image search (Workers AI BGE)               │
│  - Find similar artworks                               │
└────────────────────────────────────────────────────────┘
```

## Embedding Models

### Image Embeddings: Jina CLIP v2

**Specifications:**
- **Dimensions**: 1024
- **Resolution**: 512×512
- **Languages**: 89 (multilingual)
- **Provider**: Replicate

**Performance:**
- Flickr30k image-to-text: **98.0%**
- English CLIP text-to-image: **79.09%**
- Best for artwork similarity search

**Why Jina CLIP v2 for Art:**
- High resolution captures fine art details
- Excellent multilingual support for galleries
- State-of-the-art retrieval performance
- Optimized for creative content

### Text Embeddings: BGE (BAAI)

**Specifications:**
- **Model**: `@cf/baai/bge-base-en-v1.5`
- **Dimensions**: 768
- **Provider**: Cloudflare Workers AI
- **Languages**: English (with multilingual variant available)

**Performance:**
- Zero external API costs
- Edge-native execution
- <50ms latency

## API Endpoints

### 1. Image Similarity Search

**POST** `/api/v1/search/similar`

Find visually similar artworks by uploading an image or providing a URL.

**Request:**
```json
{
  "imageUrl": "https://example.com/artwork.jpg",
  "topK": 20,
  "minScore": 0.5,
  "filter": {
    "galleryId": "uuid",
    "artist": "Van Gogh",
    "yearMin": 1885,
    "yearMax": 1890,
    "medium": "oil on canvas"
  }
}
```

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "results": [
      {
        "artwork_id": "uuid",
        "score": 0.95,
        "title": "Starry Night",
        "artist": "Vincent van Gogh",
        "year": 1889,
        "medium": "Oil on canvas",
        "image_url": "https://...",
        "thumbnail_url": "https://...",
        "created_at": "2024-01-01T00:00:00Z"
      }
    ],
    "query_time_ms": 45,
    "total_results": 20
  }
}
```

---

### 2. Find Similar to Artwork

**GET** `/api/v1/search/similar/:artworkId`

Find artworks similar to a specific artwork in the collection.

**Query Parameters:**
- `limit` (number, default: 20): Number of results
- `min_score` (number, default: 0): Minimum similarity score (0-1)

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "results": [/* similar artworks */],
    "query_time_ms": 35,
    "total_results": 15
  }
}
```

---

### 3. Text Search (Semantic)

**POST** `/api/v1/search/text`

Search artworks using natural language descriptions.

**Request:**
```json
{
  "query": "impressionist painting of a water garden with lilies",
  "topK": 20,
  "filter": {
    "galleryId": "uuid",
    "artist": "Monet"
  }
}
```

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "results": [
      {
        "artwork_id": "uuid",
        "score": 0.89,
        "title": "Water Lilies",
        "artist": "Claude Monet",
        "year": 1916,
        "medium": "Oil on canvas",
        "description": "One of Monet's famous water lily paintings...",
        "image_url": "https://...",
        "thumbnail_url": "https://...",
        "created_at": "2024-01-01T00:00:00Z"
      }
    ],
    "query_time_ms": 52,
    "total_results": 18
  }
}
```

**Example Queries:**
- "impressionist painting with blue and yellow tones"
- "portrait of a woman in renaissance style"
- "abstract expressionist work with bold colors"
- "landscape painting from the 19th century"
- "sculpture with geometric shapes"

---

### 4. Batch Embedding Generation

**POST** `/api/v1/search/batch-embed`

Trigger embedding generation for multiple artworks.

**Request:**
```json
{
  "artworkIds": ["uuid1", "uuid2", "uuid3"],
  "force": false
}
```

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "queued": 3,
    "artwork_ids": ["uuid1", "uuid2", "uuid3"]
  }
}
```

**Note:** Embeddings are generated asynchronously. Check artwork record's `embedding_id` field to confirm completion.

---

### 5. Search Service Health

**GET** `/api/v1/search/health`

Check search service status and configuration.

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "vectorize": {
      "connected": true,
      "dimensions": 1024,
      "count": 125000
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

---

## Filtering Options

All search endpoints support filtering by artwork metadata:

| Filter | Type | Description |
|--------|------|-------------|
| `galleryId` | UUID | Filter by gallery |
| `artist` | string | Exact artist name match |
| `yearMin` | number | Minimum year (inclusive) |
| `yearMax` | number | Maximum year (inclusive) |
| `medium` | string | Exact medium match |

**Example:**
```json
{
  "filter": {
    "galleryId": "123e4567-e89b-12d3-a456-426614174000",
    "artist": "Pablo Picasso",
    "yearMin": 1900,
    "yearMax": 1910,
    "medium": "Oil on canvas"
  }
}
```

**Note:** Filters use Vectorize's metadata indexing (max 10 indexes). For more advanced filtering, consider migrating to Qdrant.

---

## Async Embedding Processing

### How It Works

1. **Upload Artwork** → Artwork saved to D1 + R2
2. **Queue Job** → Embedding job sent to Cloudflare Queue
3. **Process Job** → Worker generates embedding via Replicate
4. **Store Vector** → Embedding saved to Vectorize with metadata
5. **Update Record** → Artwork's `embedding_id` field updated

### Queue Configuration

**Queue Name:** `embedding-jobs`
**Batch Size:** 10 jobs
**Batch Timeout:** 30 seconds
**Max Retries:** 3

### Monitoring

Check embedding status:
```sql
SELECT
  id,
  title,
  embedding_id,
  created_at
FROM artworks
WHERE embedding_id IS NULL;
```

---

## Configuration

### Environment Variables

Add to `.dev.vars` (local) or Cloudflare Dashboard (production):

```env
REPLICATE_API_KEY=r8_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### Wrangler Configuration

Already configured in `wrangler.toml`:

```toml
# Vectorize Index
[[vectorize]]
binding = "VECTORIZE"
index_name = "artwork-embeddings"

# AI Binding (Workers AI)
[ai]
binding = "AI"

# Queue for async processing
[[queues.producers]]
binding = "EMBEDDING_QUEUE"
queue = "embedding-jobs"

[[queues.consumers]]
queue = "embedding-jobs"
max_batch_size = 10
max_batch_timeout = 30
```

### Create Vectorize Index

```bash
# Create index with 1024 dimensions (Jina CLIP v2)
wrangler vectorize create artwork-embeddings --dimensions=1024 --metric=cosine

# Check index status
wrangler vectorize get artwork-embeddings

# List all indexes
wrangler vectorize list
```

---

## Performance

### Latency Benchmarks

| Operation | Latency | Notes |
|-----------|---------|-------|
| Image embedding generation | 2-5s | Replicate API (cold start) |
| Image embedding generation | 0.5-1s | Replicate API (warm) |
| Text embedding generation | 50-100ms | Workers AI (edge-native) |
| Similarity search | 30-50ms | Vectorize (edge-native) |
| End-to-end search | 80-150ms | Combined |

### Scalability

| Metric | Limit | Notes |
|--------|-------|-------|
| Vectors per index | 5M | Shard for larger collections |
| Dimensions | 1536 | Max supported by Vectorize |
| TopK results | 100 | Max per query |
| Metadata size | 10KB | Per vector |
| Metadata indexes | 10 | Per Vectorize index |

---

## Cost Estimation

### Example: 100,000 Artworks, 10,000 Searches/Day

**One-time Embedding Generation:**
- 100,000 images × $0.0005 = **$50**

**Monthly Costs:**
- Vectorize storage (102.4M dimensions): **$0.05**
- Vectorize queries (307.2M dimensions): **$3.07**
- **Total: ~$3/month** (plus one-time $50 setup)

**Replicate Pricing:**
- Jina CLIP v2: ~$0.0005 per image
- Charged per prediction

**Workers AI Pricing:**
- BGE text embeddings: **FREE** (included in Workers AI)

---

## Error Handling

### Common Errors

**REPLICATE_API_KEY not configured:**
```json
{
  "success": false,
  "error": {
    "code": "SERVICE_UNAVAILABLE",
    "message": "Image embedding service not configured"
  }
}
```

**Artwork not in index:**
```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Artwork {id} not found in index"
  }
}
```

**Invalid embedding dimensions:**
```json
{
  "success": false,
  "error": {
    "code": "INVALID_EMBEDDING",
    "message": "Failed to generate valid embedding"
  }
}
```

---

## Best Practices

### 1. Image Quality
- **Minimum resolution**: 512×512 for best results
- **Recommended**: 1024×1024 or higher
- **Format**: JPEG, PNG, WebP

### 2. Search Optimization
- Use `minScore` to filter low-quality matches (0.5-0.7 recommended)
- Combine filters with vector search for better results
- Cache frequent searches using KV

### 3. Embedding Generation
- Queue embeddings asynchronously (don't block uploads)
- Monitor queue depth and processing times
- Retry failed embeddings (max 3 attempts)

### 4. Metadata
- Index frequently filtered fields (artist, year, medium)
- Keep metadata under 10KB per vector
- Use consistent naming for artists/mediums

---

## Migration to Qdrant (Future)

When you outgrow Vectorize (>5M vectors or need advanced filtering):

**Benefits of Qdrant:**
- Unlimited vectors
- Advanced metadata filtering
- Hybrid search (vector + keyword)
- Full-text search
- Better performance at scale

**Migration Steps:**
1. Export vectors from Vectorize
2. Set up Qdrant Cloud instance
3. Import vectors with metadata
4. Update API endpoints
5. Test and switch traffic

---

## Future Enhancements

- [ ] Base64 image upload support
- [ ] Multimodal search (image + text combined)
- [ ] Color-based search
- [ ] Style similarity search
- [ ] Collection-level embeddings
- [ ] Thumbnail-based quick search
- [ ] Cloudflare Images integration
- [ ] Hybrid search (vector + full-text)
- [ ] Recommendation engine
- [ ] Similar artwork suggestions (collaborative filtering)

---

## Example Use Cases

### 1. "More Like This" Feature
```javascript
// Get similar artworks to display on artwork detail page
const response = await fetch('/api/v1/search/similar/artwork-123', {
  params: { limit: 6 }
});
```

### 2. Visual Search
```javascript
// User uploads an image to find similar artworks
const formData = new FormData();
formData.append('imageUrl', userImageUrl);

const response = await fetch('/api/v1/search/similar', {
  method: 'POST',
  body: JSON.stringify({
    imageUrl: userImageUrl,
    topK: 20
  })
});
```

### 3. Natural Language Search
```javascript
// Search bar with semantic understanding
const response = await fetch('/api/v1/search/text', {
  method: 'POST',
  body: JSON.stringify({
    query: "paintings with vibrant sunset colors",
    topK: 15
  })
});
```

### 4. Gallery Recommendations
```javascript
// Find similar artworks within a specific gallery
const response = await fetch('/api/v1/search/similar/artwork-456', {
  params: {
    limit: 10,
    filter: JSON.stringify({
      galleryId: 'gallery-uuid'
    })
  }
});
```

---

## Technical References

### Jina CLIP v2
- Model: https://huggingface.co/jinaai/jina-clip-v2
- Paper: https://arxiv.org/abs/2405.20204
- API: https://replicate.com/jinaai/jina-clip-v2

### Cloudflare Vectorize
- Docs: https://developers.cloudflare.com/vectorize/
- Pricing: https://developers.cloudflare.com/vectorize/platform/pricing/
- Limits: https://developers.cloudflare.com/vectorize/platform/limits/

### Workers AI
- Models: https://developers.cloudflare.com/workers-ai/models/
- BGE Embeddings: https://developers.cloudflare.com/workers-ai/models/bge-base-en-v1.5/

---

## Support

For issues or questions:
- Check embedding status in artwork records
- Monitor queue depth: `wrangler queues list`
- View logs: `wrangler tail`
- Test search health: `GET /api/v1/search/health`
