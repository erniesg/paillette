# Paillette Development Roadmap

## Overview

This roadmap follows a Test-Driven Development (TDD) approach with 8 distinct phases. Each phase includes specific deliverables, test coverage requirements, and success criteria.

**Development Timeline**: 16-20 weeks (MVP in 8 weeks)

---

## Phase 0: Foundation & Setup (Week 1)

### Objectives
- Set up development environment
- Configure monorepo structure
- Establish CI/CD pipeline
- Create foundational tooling

### Deliverables

#### 1. Monorepo Setup
- [x] Install pnpm + Turborepo
- [ ] Configure workspace structure
- [ ] Set up shared packages
- [ ] Configure path aliases

#### 2. Cloudflare Configuration
- [ ] Install Wrangler CLI
- [ ] Configure wrangler.toml for each environment
- [ ] Set up D1 database (dev, staging, prod)
- [ ] Configure R2 buckets
- [ ] Set up Vectorize index
- [ ] Configure environment variables

#### 3. Testing Infrastructure
- [ ] Configure Vitest
- [ ] Set up @cloudflare/vitest-pool-workers
- [ ] Install Playwright
- [ ] Configure MSW for API mocking
- [ ] Set up test coverage reporting (Codecov/Coveralls)

#### 4. CI/CD Pipeline
- [ ] GitHub Actions workflows:
  - Test runner
  - Type checking
  - Linting
  - Deployment (staging)
  - Deployment (production)
- [ ] Configure branch protection rules
- [ ] Set up staging environment

#### 5. Developer Experience
- [ ] ESLint + Prettier configuration
- [ ] Husky pre-commit hooks
- [ ] VS Code workspace settings
- [ ] Development documentation

### Success Criteria
- ✅ All developers can run `pnpm install && pnpm dev` successfully
- ✅ Tests run locally and in CI
- ✅ Deployment to staging works via git push

### Test Coverage: N/A (infrastructure phase)

---

## Phase 1: Core Infrastructure & MVP (Weeks 2-3)

### TDD Focus: Database, API Foundation, Basic CRUD

### User Stories
1. As a gallery admin, I can create a gallery account
2. As a gallery admin, I can upload a single artwork image
3. As a gallery admin, I can view all uploaded artworks in a list
4. As a gallery admin, I can edit artwork metadata

### Architecture Components

#### Backend (Cloudflare Workers API)
```
apps/api/src/
├── index.ts                 # Main worker entry
├── routes/
│   ├── auth.ts             # Authentication endpoints
│   ├── galleries.ts        # Gallery CRUD
│   └── artworks.ts         # Artwork CRUD
├── middleware/
│   ├── auth.ts             # JWT validation
│   ├── error-handler.ts    # Global error handling
│   └── cors.ts             # CORS configuration
├── services/
│   ├── db.ts               # D1 database service
│   └── storage.ts          # R2 storage service
└── utils/
    ├── validation.ts       # Zod schemas
    └── response.ts         # Standard response format
```

#### Database (D1)
```sql
-- Initial migration: 001_create_tables.sql
CREATE TABLE users (...);
CREATE TABLE galleries (...);
CREATE TABLE artworks (...);
```

#### Shared Packages
```
packages/
├── database/
│   ├── src/schema.sql
│   ├── src/migrations/
│   └── src/client.ts
├── types/
│   └── src/index.ts        # Shared TypeScript types
└── validation/
    └── src/schemas.ts      # Zod schemas
```

### TDD Implementation Order

#### Step 1: Write Tests for Database Layer (RED)
```typescript
// packages/database/src/client.test.ts
describe('GalleryRepository', () => {
  it('should create a new gallery', async () => {
    const gallery = await galleryRepo.create({
      name: 'National Gallery Singapore',
      slug: 'ngs',
    });
    expect(gallery.id).toBeDefined();
    expect(gallery.name).toBe('National Gallery Singapore');
  });

  it('should retrieve gallery by ID', async () => { /*...*/ });
  it('should update gallery', async () => { /*...*/ });
  it('should delete gallery', async () => { /*...*/ });
});

describe('ArtworkRepository', () => {
  it('should create artwork', async () => { /*...*/ });
  it('should list artworks by gallery', async () => { /*...*/ });
  it('should update artwork metadata', async () => { /*...*/ });
});
```

#### Step 2: Implement Database Layer (GREEN)
```typescript
// packages/database/src/repositories/gallery.ts
export class GalleryRepository {
  constructor(private db: D1Database) {}

  async create(data: CreateGalleryInput): Promise<Gallery> {
    // Implementation
  }

  async findById(id: string): Promise<Gallery | null> {
    // Implementation
  }

  // ... other methods
}
```

#### Step 3: Write Tests for API Endpoints (RED)
```typescript
// apps/api/src/routes/galleries.test.ts
describe('POST /api/v1/galleries', () => {
  it('should create a new gallery', async () => {
    const res = await request(app)
      .post('/api/v1/galleries')
      .send({ name: 'Test Gallery', slug: 'test' })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Test Gallery');
  });

  it('should return 400 for invalid input', async () => { /*...*/ });
  it('should return 401 without auth', async () => { /*...*/ });
});

describe('GET /api/v1/galleries/:id', () => {
  it('should return gallery by ID', async () => { /*...*/ });
  it('should return 404 for non-existent gallery', async () => { /*...*/ });
});
```

#### Step 4: Implement API Endpoints (GREEN)
```typescript
// apps/api/src/routes/galleries.ts
export async function createGallery(
  req: Request,
  env: Env
): Promise<Response> {
  const body = await req.json();
  const validated = createGallerySchema.parse(body);

  const gallery = await galleryRepo.create(validated);

  return json({ success: true, data: gallery }, 201);
}
```

#### Step 5: Write Tests for R2 Image Upload (RED)
```typescript
describe('ImageUploadService', () => {
  it('should upload image to R2', async () => {
    const file = new File(['image data'], 'artwork.jpg');
    const result = await imageService.upload(file, 'gallery-1');

    expect(result.url).toContain('https://');
    expect(result.key).toMatch(/^gallery-1\/.*\.jpg$/);
  });

  it('should generate thumbnail', async () => { /*...*/ });
  it('should reject non-image files', async () => { /*...*/ });
});
```

#### Step 6: Implement Image Upload (GREEN)
```typescript
// packages/storage/src/image-service.ts
export class ImageService {
  constructor(private r2: R2Bucket) {}

  async upload(file: File, galleryId: string): Promise<UploadResult> {
    const key = `${galleryId}/${generateId()}.${getExtension(file)}`;
    await this.r2.put(key, file.stream());

    return {
      key,
      url: `https://${R2_PUBLIC_URL}/${key}`,
    };
  }
}
```

### Frontend (Remix App) - Basic UI

```
apps/web/app/
├── routes/
│   ├── _index.tsx          # Home page
│   ├── auth.login.tsx      # Login page
│   ├── galleries.$id.tsx   # Gallery detail
│   └── galleries.$id.artworks.tsx  # Artwork list
├── components/
│   ├── artwork-card.tsx
│   ├── artwork-form.tsx
│   └── file-upload.tsx
└── lib/
    ├── api-client.ts       # API wrapper with TanStack Query
    └── auth.ts             # Auth utilities
```

#### TDD for Frontend

```typescript
// apps/web/app/lib/api-client.test.ts
describe('ArtworkAPI', () => {
  it('should fetch artworks for gallery', async () => {
    const artworks = await artworkAPI.list('gallery-1');
    expect(artworks).toHaveLength(10);
  });

  it('should create artwork with image', async () => { /*...*/ });
});
```

### Deliverables
- [ ] Authentication system (JWT)
- [ ] Gallery CRUD API + UI
- [ ] Artwork CRUD API + UI
- [ ] Image upload to R2
- [ ] Basic artwork list view

### Success Criteria
- ✅ User can register and log in
- ✅ User can create a gallery
- ✅ User can upload artwork images
- ✅ User can view list of artworks
- ✅ All API endpoints return consistent response format
- ✅ All tests pass

### Test Coverage Target: **90%+**

---

## Phase 2: Embedding Generation & Basic Search (Weeks 4-5)

### TDD Focus: AI Integration, Vector Storage, Search Functionality

### User Stories
1. As a gallery admin, when I upload an image, the system automatically generates embeddings
2. As a gallery visitor, I can search for artworks using text queries
3. As a gallery visitor, I can upload an image to find similar artworks

### Architecture Components

#### AI Package
```
packages/ai/
├── src/
│   ├── embedding-service.ts      # Generate embeddings
│   ├── vector-service.ts         # Store/query vectors
│   └── providers/
│       ├── cloudflare-ai.ts      # Primary provider
│       └── openai.ts             # Fallback provider
└── tests/
    └── embedding-service.test.ts
```

#### Queue Processing
```
apps/api/src/
├── queues/
│   ├── embedding-queue.ts        # Process embedding jobs
│   └── types.ts
└── routes/
    └── search.ts                 # Search endpoints
```

### TDD Implementation Order

#### Step 1: Write Tests for Embedding Service (RED)
```typescript
describe('EmbeddingService', () => {
  it('should generate embedding for image', async () => {
    const image = await readFile('test-artwork.jpg');
    const embedding = await embeddingService.generateImageEmbedding(image);

    expect(embedding).toHaveLength(512); // CLIP embedding size
    expect(embedding[0]).toBeTypeOf('number');
  });

  it('should generate embedding for text', async () => {
    const embedding = await embeddingService.generateTextEmbedding(
      'impressionist landscape painting'
    );

    expect(embedding).toHaveLength(512);
  });

  it('should fallback to OpenAI if Cloudflare AI fails', async () => {
    // Mock Cloudflare AI to fail
    vi.mocked(cloudflareAI.run).mockRejectedValue(new Error('API Error'));

    const embedding = await embeddingService.generateImageEmbedding(image);

    expect(embedding).toHaveLength(512);
    expect(openAIProvider.createEmbedding).toHaveBeenCalled();
  });
});
```

#### Step 2: Implement Embedding Service (GREEN)
```typescript
export class EmbeddingService {
  constructor(
    private cfAI: Ai,
    private openAIProvider: OpenAIProvider
  ) {}

  async generateImageEmbedding(image: ArrayBuffer): Promise<number[]> {
    try {
      const result = await this.cfAI.run(
        '@cf/openai/clip-vit-base-patch16',
        { image: Array.from(new Uint8Array(image)) }
      );
      return result.data[0];
    } catch (error) {
      console.warn('Cloudflare AI failed, falling back to OpenAI', error);
      return this.openAIProvider.createEmbedding(image);
    }
  }

  async generateTextEmbedding(text: string): Promise<number[]> {
    const result = await this.cfAI.run(
      '@cf/baai/bge-base-en-v1.5',
      { text }
    );
    return result.data[0];
  }
}
```

#### Step 3: Write Tests for Vector Service (RED)
```typescript
describe('VectorService', () => {
  it('should store embedding in Vectorize', async () => {
    const artworkId = 'artwork-1';
    const embedding = new Array(512).fill(0).map(() => Math.random());

    await vectorService.upsert(artworkId, embedding, {
      galleryId: 'gallery-1',
    });

    // Should not throw
  });

  it('should find similar artworks by vector', async () => {
    const queryEmbedding = [...]; // test embedding
    const results = await vectorService.search(queryEmbedding, {
      topK: 10,
      galleryId: 'gallery-1',
    });

    expect(results).toHaveLength(10);
    expect(results[0]).toHaveProperty('id');
    expect(results[0]).toHaveProperty('score');
    expect(results[0].score).toBeGreaterThan(0.8); // High similarity
  });
});
```

#### Step 4: Implement Vector Service (GREEN)
```typescript
export class VectorService {
  constructor(private vectorize: Vectorize) {}

  async upsert(
    id: string,
    embedding: number[],
    metadata: VectorMetadata
  ): Promise<void> {
    await this.vectorize.upsert([
      {
        id,
        values: embedding,
        metadata,
      },
    ]);
  }

  async search(
    queryVector: number[],
    options: SearchOptions
  ): Promise<SearchResult[]> {
    const results = await this.vectorize.query(queryVector, {
      topK: options.topK || 10,
      filter: { galleryId: options.galleryId },
    });

    return results.matches;
  }
}
```

#### Step 5: Write Tests for Queue Processing (RED)
```typescript
describe('EmbeddingQueue', () => {
  it('should process embedding job', async () => {
    const job = {
      artworkId: 'artwork-1',
      imageUrl: 'https://r2.example.com/image.jpg',
    };

    await embeddingQueue.process(job);

    // Verify embedding was generated and stored
    const artwork = await artworkRepo.findById('artwork-1');
    expect(artwork.embeddingId).toBeDefined();

    // Verify vector was stored in Vectorize
    const vector = await vectorService.getById('artwork-1');
    expect(vector).toBeDefined();
  });

  it('should retry failed jobs up to 3 times', async () => { /*...*/ });
});
```

#### Step 6: Write Tests for Search API (RED)
```typescript
describe('POST /api/v1/galleries/:id/search/text', () => {
  it('should return artworks matching text query', async () => {
    const res = await request(app)
      .post('/api/v1/galleries/gallery-1/search/text')
      .send({ query: 'impressionist landscape' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(10);
    expect(res.body.data[0]).toHaveProperty('title');
    expect(res.body.data[0]).toHaveProperty('similarity');
  });

  it('should return empty array for no matches', async () => { /*...*/ });
});

describe('POST /api/v1/galleries/:id/search/image', () => {
  it('should return similar artworks for uploaded image', async () => {
    const res = await request(app)
      .post('/api/v1/galleries/gallery-1/search/image')
      .attach('image', 'test-query.jpg')
      .expect(200);

    expect(res.body.data).toHaveLength(10);
  });
});
```

#### Step 7: Implement Search API (GREEN)
```typescript
export async function textSearch(req: Request, env: Env): Promise<Response> {
  const { query } = await req.json();
  const { galleryId } = req.params;

  // Generate query embedding
  const queryEmbedding = await embeddingService.generateTextEmbedding(query);

  // Search vectors
  const vectorResults = await vectorService.search(queryEmbedding, {
    topK: 20,
    galleryId,
  });

  // Fetch artwork details
  const artworks = await artworkRepo.findByIds(
    vectorResults.map((r) => r.id)
  );

  // Combine with similarity scores
  const results = artworks.map((artwork, i) => ({
    ...artwork,
    similarity: vectorResults[i].score,
  }));

  return json({ success: true, data: results });
}
```

### Frontend Updates

#### TanStack Query Integration
```typescript
// apps/web/app/lib/queries.ts
export const useArtworkSearch = (galleryId: string) => {
  return useMutation({
    mutationFn: async (query: string) => {
      const res = await fetch(`/api/v1/galleries/${galleryId}/search/text`, {
        method: 'POST',
        body: JSON.stringify({ query }),
      });
      return res.json();
    },
  });
};
```

#### Search UI Component
```tsx
// apps/web/app/components/artwork-search.tsx
export function ArtworkSearch({ galleryId }: Props) {
  const searchMutation = useArtworkSearch(galleryId);

  return (
    <div>
      <input
        type="text"
        placeholder="Search artworks..."
        onChange={(e) => searchMutation.mutate(e.target.value)}
      />
      {searchMutation.isLoading && <Spinner />}
      {searchMutation.data && <ArtworkGrid artworks={searchMutation.data} />}
    </div>
  );
}
```

### Deliverables
- [ ] Embedding generation service (Cloudflare AI + OpenAI fallback)
- [ ] Vector storage in Vectorize
- [ ] Cloudflare Queue for async embedding jobs
- [ ] Text search API endpoint
- [ ] Image similarity search API endpoint
- [ ] Search UI components

### Success Criteria
- ✅ Embeddings are automatically generated on image upload
- ✅ Text search returns relevant artworks
- ✅ Image search returns visually similar artworks
- ✅ Search response time < 200ms (P95)
- ✅ Embedding generation < 500ms
- ✅ All tests pass

### Test Coverage Target: **90%+**

---

## Phase 3: Metadata Management & Grid View (Week 6)

### TDD Focus: CSV Upload, Filtering, TanStack Table

### User Stories
1. As a gallery admin, I can upload a CSV file to bulk import artwork metadata
2. As a gallery visitor, I can view artworks in a grid with sorting and filtering
3. As a gallery visitor, I can copy citation information for each artwork

### Architecture Components

#### CSV Processing
```
packages/metadata/
├── src/
│   ├── csv-parser.ts         # Parse and validate CSV
│   ├── schema-validator.ts   # Dynamic schema validation
│   └── batch-updater.ts      # Batch database updates
```

#### Frontend (TanStack Table)
```
apps/web/app/components/
├── artwork-grid.tsx          # Main grid component
├── artwork-table.tsx         # Table view (TanStack Table)
├── column-filter.tsx         # Filter dropdowns
└── citation-popup.tsx        # Citation copy UI
```

### TDD Implementation Order

#### Step 1: Write Tests for CSV Parser (RED)
```typescript
describe('CSVParser', () => {
  it('should parse valid CSV', async () => {
    const csv = `
      id,title,artist,year
      art-1,Starry Night,Vincent van Gogh,1889
      art-2,Mona Lisa,Leonardo da Vinci,1503
    `;

    const result = await csvParser.parse(csv);

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual({
      id: 'art-1',
      title: 'Starry Night',
      artist: 'Vincent van Gogh',
      year: 1889,
    });
  });

  it('should validate column types', async () => {
    const csv = `id,year\nart-1,invalid`; // 'invalid' is not a number

    await expect(csvParser.parse(csv)).rejects.toThrow('Invalid year');
  });

  it('should handle missing optional columns', async () => { /*...*/ });
  it('should detect duplicate IDs', async () => { /*...*/ });
});
```

#### Step 2: Write Tests for Batch Update (RED)
```typescript
describe('BatchMetadataUpdater', () => {
  it('should update metadata for existing artworks', async () => {
    const updates = [
      { id: 'art-1', title: 'New Title', artist: 'New Artist' },
      { id: 'art-2', year: 2024 },
    ];

    const result = await batchUpdater.update('gallery-1', updates);

    expect(result.updated).toBe(2);
    expect(result.failed).toBe(0);

    // Verify changes
    const art1 = await artworkRepo.findById('art-1');
    expect(art1.title).toBe('New Title');
  });

  it('should create new artworks if IDs not found', async () => { /*...*/ });
  it('should rollback on validation errors', async () => { /*...*/ });
});
```

#### Step 3: Write Tests for Metadata API (RED)
```typescript
describe('POST /api/v1/galleries/:id/metadata/upload', () => {
  it('should upload and process CSV', async () => {
    const csv = `id,title,artist\nart-1,Test,Artist`;

    const res = await request(app)
      .post('/api/v1/galleries/gallery-1/metadata/upload')
      .attach('file', Buffer.from(csv), 'metadata.csv')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.updated).toBe(1);
    expect(res.body.data.failed).toBe(0);
  });

  it('should return validation errors', async () => { /*...*/ });
});
```

#### Step 4: Frontend Grid Component Tests (RED)
```typescript
describe('ArtworkGrid', () => {
  it('should render artworks in grid', () => {
    const artworks = [/* mock data */];
    render(<ArtworkGrid artworks={artworks} />);

    expect(screen.getAllByRole('img')).toHaveLength(artworks.length);
  });

  it('should filter by artist', async () => {
    render(<ArtworkGrid artworks={mockArtworks} />);

    const filterInput = screen.getByPlaceholderText('Filter by artist');
    await userEvent.type(filterInput, 'Van Gogh');

    expect(screen.getAllByRole('img')).toHaveLength(5); // Only Van Gogh
  });

  it('should copy citation on click', async () => {
    render(<ArtworkGrid artworks={mockArtworks} />);

    const citationBtn = screen.getByLabelText('Copy citation');
    await userEvent.click(citationBtn);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'Van Gogh, Vincent. Starry Night. 1889.'
    );
  });
});
```

#### Step 5: Implement TanStack Table Grid (GREEN)
```tsx
// apps/web/app/components/artwork-table.tsx
export function ArtworkTable({ artworks }: Props) {
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  const table = useReactTable({
    data: artworks,
    columns: artworkColumns,
    state: { columnFilters },
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div>
      {/* Filter inputs */}
      <div>
        {table.getHeaderGroups().map((headerGroup) =>
          headerGroup.headers.map((header) => (
            <ColumnFilter key={header.id} column={header.column} />
          ))
        )}
      </div>

      {/* Table */}
      <table>
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th key={header.id}>
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

### Deliverables
- [ ] CSV upload and parsing
- [ ] Batch metadata update
- [ ] Metadata validation
- [ ] TanStack Table grid view
- [ ] Column filtering and sorting
- [ ] Citation copy functionality

### Success Criteria
- ✅ CSV with 1000 rows processes in < 5 seconds
- ✅ Grid view supports 10,000+ artworks with virtualization
- ✅ Filters update in < 100ms
- ✅ Citation copies to clipboard successfully

### Test Coverage Target: **90%+**

---

## Phase 4: Color Search & Advanced Filters (Week 7)

### User Stories
1. As a visitor, I can search for artworks by dominant colors
2. As a visitor, I can combine multiple search filters (text + color + metadata)

### Deliverables
- [ ] Color extraction from images
- [ ] Color-based search
- [ ] Multi-filter combination logic
- [ ] Color picker UI component

### Test Coverage Target: **85%+**

---

## Phase 5: Embedding Projector (Weeks 8-9)

### User Stories
1. As a visitor, I can visualize artworks in 2D/3D embedding space
2. As a visitor, I can click on artwork clusters to explore similar pieces

### Deliverables
- [ ] UMAP/t-SNE dimensionality reduction
- [ ] Interactive 3D visualization (Three.js)
- [ ] Cluster detection algorithm
- [ ] Zoom and pan controls

### Test Coverage Target: **70%+** (visualization is harder to test)

---

## Phase 6: Frame Removal & Image Processing (Week 10)

### User Stories
1. As a curator, I can upload a photographed artwork and automatically remove the frame
2. As a curator, I can preview the frame removal before confirming

### Deliverables
- [ ] Integration with Replicate (SAM model)
- [ ] Frame detection algorithm
- [ ] Crop and perspective correction
- [ ] Before/after preview UI

### Test Coverage Target: **85%+**

---

## Phase 7: Multi-Language Translation (Weeks 11-12)

### User Stories
1. As a curator, I can translate artwork descriptions to all supported languages
2. As a curator, I can upload a document and get translations in all languages

### Deliverables
- [ ] Multi-provider translation service (Google, DeepL, Azure)
- [ ] Batch translation for documents
- [ ] Translation quality scoring
- [ ] Language selector UI

### Test Coverage Target: **90%+**

---

## Phase 8: API & Documentation (Week 13)

### User Stories
1. As a developer, I can access all features via REST API
2. As a developer, I can authenticate using API keys
3. As a developer, I can read comprehensive API documentation

### Deliverables
- [ ] Public API endpoints with authentication
- [ ] API key generation and management
- [ ] Rate limiting (100 req/min)
- [ ] OpenAPI/Swagger documentation
- [ ] API playground

### Test Coverage Target: **95%+**

---

## Phase 9: Production Readiness (Weeks 14-16)

### Objectives
- [ ] Performance optimization
- [ ] Security audit
- [ ] Error monitoring (Sentry)
- [ ] Load testing
- [ ] Documentation and training materials

### Success Criteria
- ✅ All performance targets met (see ARCHITECTURE.md)
- ✅ Security audit passed
- ✅ Load test: 1000 concurrent users handled
- ✅ Overall test coverage: **95%+**

---

## Testing Milestones

| Phase | Unit Tests | Integration Tests | E2E Tests | Coverage |
|-------|-----------|------------------|-----------|----------|
| 0 | N/A | N/A | N/A | N/A |
| 1 | 50 | 20 | 3 | 90% |
| 2 | 70 | 30 | 5 | 90% |
| 3 | 90 | 40 | 8 | 90% |
| 4 | 100 | 45 | 10 | 85% |
| 5 | 110 | 50 | 12 | 70% |
| 6 | 130 | 60 | 14 | 85% |
| 7 | 150 | 70 | 16 | 90% |
| 8 | 170 | 80 | 18 | 95% |
| 9 | 180 | 85 | 20 | 95% |

---

## Success Metrics

### By Phase 3 (MVP - Week 6)
- User can upload artworks
- User can search by text and image
- User can view results in grid
- Test coverage: 90%+

### By Phase 8 (Full Features - Week 13)
- All 10 core features implemented
- API available for external use
- Test coverage: 95%+

### Production Launch (Week 16)
- 10 galleries onboarded
- 10,000+ artworks indexed
- < 200ms P95 API response time
- 99.9% uptime

---

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Cloudflare Vectorize limits | High | Test with large datasets early; plan fallback to Pinecone |
| D1 beta instability | Medium | Regular backups; consider PostgreSQL on Neon |
| Translation API costs | Medium | Implement caching; offer manual translation option |
| Frame removal accuracy | Low | Allow manual crop as fallback |
| Embedding quality | High | Compare multiple models; allow manual tagging |

---

## Next Steps

1. Review and approve this roadmap
2. Begin Phase 0: Foundation setup
3. Set up project tracking (GitHub Projects)
4. Schedule weekly progress reviews
