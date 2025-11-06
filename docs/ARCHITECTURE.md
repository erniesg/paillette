# Paillette - System Architecture & Technology Stack

## Executive Summary

Paillette is a multimodal AI-powered platform for art gallery management, designed as a modern, scalable system deployed on Cloudflare's edge infrastructure. This document outlines the architectural decisions, technology stack, and implementation strategy.

## Table of Contents

1. [Technology Stack Decisions](#technology-stack-decisions)
2. [System Architecture](#system-architecture)
3. [Data Models](#data-models)
4. [API Design](#api-design)
5. [Security & Authentication](#security--authentication)
6. [Deployment Strategy](#deployment-strategy)
7. [Testing Strategy](#testing-strategy)

---

## Technology Stack Decisions

### 🎯 Core Platform: Cloudflare Workers Ecosystem

**Rationale**: Cloudflare Workers provides edge computing with global distribution, low latency, and integrated AI capabilities - perfect for a gallery platform serving international audiences.

#### Cloudflare Services Selected:

| Service | Purpose | Justification |
|---------|---------|---------------|
| **Cloudflare Workers** | API & Business Logic | Serverless, edge-deployed, <1ms cold starts |
| **Cloudflare R2** | Image Storage | S3-compatible, zero egress fees, perfect for images |
| **Cloudflare D1** | Metadata Database | SQLite at the edge, low-latency relational data |
| **Cloudflare Vectorize** | Vector Search | Native vector database for embeddings, similarity search |
| **Cloudflare AI** | Embeddings & Vision | Built-in CLIP models, image classification, no external API calls |
| **Cloudflare Images** | Image Optimization | Automatic resizing, format conversion, CDN delivery |
| **Cloudflare KV** | Caching Layer | Distributed key-value for sessions, API tokens |
| **Cloudflare Durable Objects** | Real-time Features | Stateful coordination for collaborative editing |
| **Cloudflare Queues** | Async Processing | Background jobs for embeddings, translations |

### 🚀 Frontend Stack

#### Framework: **Remix** (deployed to Cloudflare Pages)

**Why Remix?**
- Native Cloudflare Workers support
- Server-side rendering at the edge
- Built-in data loading patterns
- Type-safe APIs via TypeScript
- Progressive enhancement
- Excellent DX with hot reloading

**Alternative considered**: Next.js (rejected due to Vercel-centric design)

#### UI Libraries:

**TanStack Ecosystem** ✅ HIGHLY RELEVANT

| Library | Use Case | Critical? |
|---------|----------|-----------|
| **@tanstack/react-query** | API data fetching, caching, optimistic updates | ✅ YES |
| **@tanstack/react-table** | Grid views, sortable/filterable artwork tables | ✅ YES |
| **@tanstack/react-virtual** | Virtualizing large image grids (1000+ artworks) | ✅ YES |
| **@tanstack/react-router** | Type-safe routing (if not using Remix) | ❌ NO (Remix handles this) |
| **@tanstack/react-form** | Form management for metadata editing | ⚠️ MAYBE (React Hook Form alternative) |

**Other UI Dependencies:**
- **Radix UI**: Headless, accessible components (dialogs, dropdowns)
- **Tailwind CSS**: Utility-first styling
- **Framer Motion**: Animations for embedding projector
- **D3.js / Three.js**: Embedding space visualization (UMAP/t-SNE)
- **react-dropzone**: File uploads
- **react-color**: Color picker for color search

### 🧠 AI/ML Services

#### Embedding Generation
1. **Primary**: Cloudflare AI Workers (CLIP model)
   - `@cf/openai/clip-vit-base-patch16` for images
   - `@cf/baai/bge-base-en-v1.5` for text embeddings

2. **Fallback**: OpenAI API (CLIP via embeddings API)

#### Frame Removal
1. **Primary**: External SAM (Segment Anything Model) via Replicate API
2. **Fallback**: Cloudflare AI image segmentation (if available)

#### Translation Providers (Multi-provider strategy)

| Language Pair | Provider | Rationale |
|---------------|----------|-----------|
| EN → ZH | DeepL Pro | Best EN-ZH quality |
| EN → Tamil | Google Translate | Broader language support |
| EN → Malay | Google Translate | Regional language expertise |
| ZH → EN | DeepL Pro | Best ZH-EN quality |
| Cross-Asian | Azure Translator | Asian language specialization |

**Implementation**: Provider selection logic with automatic fallback

### 📦 Package Management & Monorepo

**Tool**: **pnpm** + **Turborepo**

**Structure**:
```
paillette/
├── apps/
│   ├── web/              # Remix frontend (Cloudflare Pages)
│   ├── api/              # Cloudflare Workers API
│   └── docs/             # API documentation site
├── packages/
│   ├── database/         # D1 schema & migrations
│   ├── ai/               # AI/ML utilities (embeddings, vision)
│   ├── translation/      # Multi-provider translation
│   ├── ui/               # Shared React components
│   └── types/            # Shared TypeScript types
└── tooling/
    ├── eslint-config/
    ├── typescript-config/
    └── vitest-config/
```

### 🧪 Testing Stack (TDD Approach)

| Tool | Purpose |
|------|---------|
| **Vitest** | Unit & integration tests (Vite-native) |
| **Playwright** | E2E tests |
| **MSW** | API mocking |
| **@cloudflare/vitest-pool-workers** | Test Workers locally |
| **Faker.js** | Test data generation |

**Coverage Target**: 95%+

---

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        User Browser                          │
│  (React + Remix + TanStack Query/Table/Virtual)             │
└────────────────────┬────────────────────────────────────────┘
                     │ HTTPS
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              Cloudflare Edge Network                         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Cloudflare Workers API                              │   │
│  │  - REST endpoints                                    │   │
│  │  - Authentication middleware                         │   │
│  │  - Rate limiting                                     │   │
│  └────┬──────────────┬──────────────┬───────────────┬───┘   │
│       │              │              │               │       │
│       ▼              ▼              ▼               ▼       │
│  ┌────────┐    ┌──────────┐   ┌─────────┐    ┌─────────┐  │
│  │   D1   │    │   R2     │   │Vectorize│    │   KV    │  │
│  │(SQLite)│    │(S3-like) │   │(Vectors)│    │(Cache)  │  │
│  └────────┘    └──────────┘   └─────────┘    └─────────┘  │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              Cloudflare Queues                               │
│  - Embedding generation jobs                                 │
│  - Translation batch jobs                                    │
│  - Frame removal jobs                                        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│         Background Workers (Queue Consumers)                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ Cloudflare  │  │ Translation │  │ Replicate   │         │
│  │ AI Worker   │  │  Service    │  │ (SAM API)   │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow Examples

#### 1. Image Upload & Embedding Flow
```
User uploads image
  → Upload to R2 (with unique ID)
  → Store metadata in D1
  → Enqueue embedding job
  → Worker: Generate embedding via Cloudflare AI
  → Store embedding in Vectorize
  → Return success to user
```

#### 2. Image Similarity Search Flow
```
User uploads query image
  → Generate embedding via Cloudflare AI
  → Query Vectorize for nearest neighbors
  → Fetch metadata from D1 for matching IDs
  → Fetch image URLs from R2
  → Return results to user
```

#### 3. Metadata CSV Upload Flow
```
User uploads CSV
  → Parse CSV in Worker
  → Validate against schema
  → Batch upsert to D1
  → Return success/error report
```

---

## Data Models

### Core Entities

#### 1. Artwork
```typescript
interface Artwork {
  id: string;                    // UUID
  galleryId: string;             // FK to Gallery
  collectionId?: string;         // Optional collection grouping

  // Image data
  imageUrl: string;              // R2 URL
  thumbnailUrl: string;          // Cloudflare Images optimized
  originalFilename: string;
  imageHash: string;             // For deduplication

  // Embeddings (stored in Vectorize, referenced here)
  embeddingId: string;           // Vector ID in Vectorize

  // Metadata
  title: string;
  artist?: string;
  year?: number;
  medium?: string;
  dimensions?: {
    height: number;
    width: number;
    depth?: number;
    unit: 'cm' | 'in' | 'm';
  };
  description?: string;
  provenance?: string;

  // Multi-language support
  translations?: {
    [languageCode: string]: {
      title?: string;
      description?: string;
    };
  };

  // Color analysis
  dominantColors?: string[];     // Hex codes
  colorPalette?: {
    color: string;
    percentage: number;
  }[];

  // Custom metadata (flexible JSON)
  customMetadata?: Record<string, any>;

  // Citation info
  citation?: {
    format: 'mla' | 'apa' | 'chicago';
    text: string;
  };

  // Timestamps
  createdAt: string;
  updatedAt: string;
  uploadedBy: string;            // FK to User
}
```

#### 2. Gallery
```typescript
interface Gallery {
  id: string;
  name: string;
  slug: string;                  // URL-friendly
  description?: string;
  location?: {
    country: string;
    city: string;
    address?: string;
  };
  website?: string;

  // Settings
  settings: {
    allowPublicAccess: boolean;
    enableEmbeddingProjector: boolean;
    defaultLanguage: string;
    supportedLanguages: string[];
  };

  // API access
  apiKey: string;
  apiKeyHash: string;            // Hashed for security

  createdAt: string;
  ownerId: string;               // FK to User
}
```

#### 3. Collection
```typescript
interface Collection {
  id: string;
  galleryId: string;
  name: string;
  description?: string;
  artworkCount: number;
  thumbnailArtworkId?: string;   // Featured image

  createdAt: string;
  createdBy: string;
}
```

#### 4. User
```typescript
interface User {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  role: 'admin' | 'curator' | 'viewer';

  // Permissions
  galleries: string[];           // Gallery IDs user has access to

  createdAt: string;
  lastLoginAt?: string;
}
```

### Database Schema (D1 - SQLite)

```sql
-- See packages/database/schema.sql for full schema
CREATE TABLE galleries (...);
CREATE TABLE users (...);
CREATE TABLE artworks (...);
CREATE TABLE collections (...);
CREATE TABLE artwork_collections (...);  -- M:M relationship
CREATE TABLE upload_jobs (...);          -- Track batch uploads
CREATE TABLE audit_logs (...);           -- Track all changes
```

### Vector Storage (Vectorize)

```typescript
// Vectorize index configuration
{
  name: "artwork-embeddings",
  dimensions: 512,              // CLIP embedding size
  metric: "cosine",             // Similarity metric
  metadata: {
    artworkId: string,
    galleryId: string,
    uploadedAt: timestamp
  }
}
```

---

## API Design

### REST API Endpoints

#### Authentication
```
POST   /api/v1/auth/login
POST   /api/v1/auth/register
POST   /api/v1/auth/logout
GET    /api/v1/auth/me
```

#### Galleries
```
GET    /api/v1/galleries
POST   /api/v1/galleries
GET    /api/v1/galleries/:id
PATCH  /api/v1/galleries/:id
DELETE /api/v1/galleries/:id
```

#### Artworks
```
GET    /api/v1/galleries/:galleryId/artworks
POST   /api/v1/galleries/:galleryId/artworks          # Single upload
POST   /api/v1/galleries/:galleryId/artworks/batch    # Batch upload
GET    /api/v1/galleries/:galleryId/artworks/:id
PATCH  /api/v1/galleries/:galleryId/artworks/:id
DELETE /api/v1/galleries/:galleryId/artworks/:id
```

#### Metadata Management
```
POST   /api/v1/galleries/:galleryId/metadata/upload   # CSV upload
GET    /api/v1/galleries/:galleryId/metadata/schema   # Get metadata fields
PATCH  /api/v1/galleries/:galleryId/metadata/schema   # Update schema
```

#### Search
```
POST   /api/v1/galleries/:galleryId/search/text       # Text search
POST   /api/v1/galleries/:galleryId/search/image      # Image similarity
POST   /api/v1/galleries/:galleryId/search/color      # Color search
POST   /api/v1/galleries/:galleryId/search/multimodal # Combined search
```

#### Embedding Projector
```
GET    /api/v1/galleries/:galleryId/embeddings/projection  # Get UMAP/t-SNE data
GET    /api/v1/galleries/:galleryId/embeddings/clusters    # Get cluster info
```

#### Image Processing
```
POST   /api/v1/process/remove-frame                   # Frame removal
GET    /api/v1/process/jobs/:jobId                    # Job status
```

#### Translation
```
POST   /api/v1/translate/text                         # Instant translation
POST   /api/v1/translate/document                     # Document upload
GET    /api/v1/translate/jobs/:jobId                  # Translation job status
GET    /api/v1/translate/jobs/:jobId/download         # Download translations
```

### API Response Format

```typescript
// Success response
{
  success: true,
  data: T,
  metadata?: {
    page?: number,
    pageSize?: number,
    total?: number,
    took?: number  // ms
  }
}

// Error response
{
  success: false,
  error: {
    code: string,
    message: string,
    details?: any
  }
}
```

---

## Security & Authentication

### Authentication Strategy

1. **User Authentication**: JWT tokens stored in HttpOnly cookies
2. **API Authentication**: API keys for programmatic access
3. **Rate Limiting**: Token bucket algorithm via Durable Objects

### Authorization Levels

```typescript
enum Permission {
  GALLERY_READ = 'gallery:read',
  GALLERY_WRITE = 'gallery:write',
  GALLERY_ADMIN = 'gallery:admin',

  ARTWORK_READ = 'artwork:read',
  ARTWORK_WRITE = 'artwork:write',
  ARTWORK_DELETE = 'artwork:delete',

  API_ACCESS = 'api:access',
}

// Role-based permissions
const ROLES = {
  admin: [/* all permissions */],
  curator: [GALLERY_READ, GALLERY_WRITE, ARTWORK_READ, ARTWORK_WRITE],
  viewer: [GALLERY_READ, ARTWORK_READ],
};
```

### Security Measures

- CORS configuration for allowed origins
- Input validation & sanitization (Zod schemas)
- SQL injection prevention (parameterized queries)
- Rate limiting: 100 req/min for authenticated, 20 req/min for public
- API key rotation
- Audit logging for all mutations

---

## Deployment Strategy

### Environments

1. **Development**: Local with Wrangler + Miniflare
2. **Staging**: Cloudflare Workers (staging environment)
3. **Production**: Cloudflare Workers (production environment)

### CI/CD Pipeline (GitHub Actions)

```yaml
# Simplified workflow
name: Deploy

on:
  push:
    branches: [main, develop]
  pull_request:

jobs:
  test:
    - Run Vitest (unit + integration)
    - Run Playwright (E2E)
    - Check coverage (95%+ required)

  lint:
    - ESLint
    - TypeScript type checking
    - Prettier formatting

  deploy-staging:
    if: branch == develop
    - Deploy to staging environment
    - Run smoke tests

  deploy-production:
    if: branch == main
    - Deploy to production
    - Run health checks
```

### Monitoring & Observability

- **Cloudflare Analytics**: Request metrics, error rates
- **Sentry**: Error tracking & alerting
- **Custom metrics**: Vector search latency, embedding generation time
- **Logs**: Structured logging with log levels

---

## Testing Strategy (TDD Approach)

### Test Pyramid

```
         /\
        /E2E\          10% - Critical user flows
       /──────\
      /  INT   \       30% - API endpoints, DB operations
     /──────────\
    /    UNIT    \     60% - Business logic, utilities
   /──────────────\
```

### Testing Phases

#### Phase 1: Unit Tests (Foundation)
- Utility functions
- Validation schemas (Zod)
- Data transformations
- AI service abstractions

#### Phase 2: Integration Tests
- API endpoint handlers
- Database operations (D1)
- Vector search (Vectorize)
- Queue processing

#### Phase 3: E2E Tests (Critical Paths)
1. User uploads image → generates embedding → searches successfully
2. User uploads CSV → metadata associates → displays in grid
3. User performs multimodal search → views results → copies citation
4. User uploads document → translates to all languages → downloads

### Test File Structure

```
apps/api/
  src/
    routes/
      artworks.ts
      artworks.test.ts      # Integration tests
  tests/
    e2e/
      artwork-upload.spec.ts

packages/ai/
  src/
    embeddings.ts
    embeddings.test.ts      # Unit tests
```

### Mocking Strategy

```typescript
// Mock Cloudflare AI
vi.mock('@cloudflare/ai', () => ({
  Ai: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({ data: [[/* mock embedding */]] })
  }))
}));
```

---

## Performance Targets

| Metric | Target | Measurement |
|--------|--------|-------------|
| P95 API Response Time | < 200ms | Cloudflare Analytics |
| Image Upload (10MB) | < 3s | Custom timing |
| Embedding Generation | < 500ms | Queue metrics |
| Vector Search (1M artworks) | < 100ms | Custom timing |
| Page Load (Grid View) | < 1s | Lighthouse |
| Embedding Projector Load | < 2s | Custom timing |

---

## Scalability Considerations

### Current Phase (MVP)
- Target: 10 galleries, 10K artworks per gallery
- Cost estimate: ~$50/month (Cloudflare Workers + R2)

### Growth Phase
- Target: 100 galleries, 100K artworks per gallery
- Considerations:
  - D1 scaling (consider sharding by gallery)
  - Vectorize limits (check dimensions & index size)
  - R2 bandwidth (leverage Cloudflare Images CDN)

### Enterprise Phase
- Target: 1000+ galleries, 1M+ artworks
- Considerations:
  - Multi-region deployment
  - Dedicated Durable Objects for large galleries
  - Custom caching strategies
  - Database federation

---

## Technology Decision Summary

### ✅ TanStack is HIGHLY RELEVANT
**Use**: Query (essential), Table (essential), Virtual (essential)
**Skip**: Router (Remix provides this)

### ✅ Cloudflare Workers is IDEAL
- Edge computing for global latency
- Integrated AI (no external API costs for embeddings)
- Native vector search (Vectorize)
- Zero egress fees (R2)
- Excellent DX (Wrangler, local dev)

### ⚠️ Considerations
- D1 is still in beta (check limits)
- Vectorize dimensions limits (verify CLIP embedding size support)
- Workers have 128MB memory limit (batch processing considerations)
- Translation APIs will be the main external cost

---

## Next Steps

See [ROADMAP.md](./ROADMAP.md) for phased development plan.
