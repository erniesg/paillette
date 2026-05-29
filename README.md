# Paillette 🎨

> AI-powered multimodal search and management platform for art galleries worldwide

[![CI](https://github.com/yourusername/paillette/workflows/CI/badge.svg)](https://github.com/yourusername/paillette/actions)
[![License](https://img.shields.io/badge/license-TBD-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-orange)](https://workers.cloudflare.com/)

## Overview

Paillette enables galleries to manage, search, and discover artworks through advanced AI capabilities including image embeddings, multimodal search, automatic metadata management, and multi-language translation.

Starting with the **National Gallery Singapore**, we're building a platform that makes art more accessible and searchable for galleries worldwide.

## Visit

- [Paillette NGS search](https://paillette-stg.berlayar.ai/ngs/search)
- [National Gallery Singapore Collection Search](https://www.nationalgallery.sg/sg/en/our-collections/search-collection.html), the source collection currently represented in Paillette

## Core Features

### 1. Image Collection & Embedding Generation
- Upload collections of artwork images
- Automatic embedding generation for semantic search
- Enable visual similarity search across entire collections

### 2. Metadata Management
- Upload and associate metadata via CSV
- Edit individual artwork entries (image + metadata)
- Manage collections with minimal existing metadata

### 3. Multimodal Search
- **Text search**: Search using natural language queries via embeddings
- **Image search**: Upload an image to find visually similar artworks
- **Color search**: Find artworks by color palette
- **Metadata filters**: Filter by any metadata column

### 4. Artwork Viewing & Management
- Grid view with citation copy functionality
- Detailed artwork view with full metadata
- Filter and sort by metadata columns
- Click to view enlarged images and details

### 5. Embedding Projector
- Visualize artwork collections in embedding space
- Similar artworks cluster together
- Interactive exploration of visual relationships

### 6. Image Processing
- Automatic picture frame removal
- Extract clean artwork from photographed images
- Add metadata to processed images

### 7. Multi-Language Translation
- Instant translation of text/documents
- Support for EN, Chinese, Tamil, Malay
- Multiple provider integration for best quality
- Download as single or multiple documents

### 8. API Access
- RESTful APIs for all core functionality
- Proper authentication and authorization
- Comprehensive API documentation
- Easy integration with gallery systems

## Tech Stack

### Frontend
- **Framework**: [Remix](https://remix.run/) (deployed to Cloudflare Pages)
- **UI Library**: React 18 + TypeScript
- **Data Fetching**: TanStack Query (React Query)
- **Table/Grid**: TanStack Table + TanStack Virtual
- **Styling**: Tailwind CSS + Radix UI
- **Animations**: Framer Motion

### Backend
- **Platform**: [Cloudflare Workers](https://workers.cloudflare.com/) (Edge computing)
- **API Framework**: [Hono](https://hono.dev/) (Fast, lightweight web framework)
- **Database**: Cloudflare D1 (SQLite at the edge)
- **Object Storage**: Cloudflare R2 (S3-compatible)
- **Vector Database**: Cloudflare Vectorize
- **Caching**: Cloudflare KV
- **Queue**: Cloudflare Queues (for async processing)

### AI/ML
- **Embeddings**: Cloudflare AI (CLIP models)
- **Image Processing**: Replicate API (SAM model for frame removal)
- **Translation**: Multi-provider (DeepL, Google Translate, Azure)

### Developer Tools
- **Monorepo**: Turborepo + pnpm workspaces
- **Testing**: Vitest (unit/integration) + Playwright (E2E)
- **Type Safety**: TypeScript + Zod
- **Linting**: ESLint + Prettier
- **CI/CD**: GitHub Actions

## Quick Start

### Prerequisites

- Node.js >= 20.0.0
- pnpm >= 9.0.0
- Cloudflare account ([sign up](https://dash.cloudflare.com/sign-up))

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/paillette.git
cd paillette

# Install dependencies
pnpm install

# Set up Cloudflare resources (D1, R2, Vectorize, etc.)
# See docs/GETTING_STARTED.md for detailed instructions

# Start development servers
pnpm dev
```

The API will be available at `http://localhost:8787` and the web app at `http://localhost:5173`.

**For detailed setup instructions, see [Getting Started Guide](docs/GETTING_STARTED.md)**

## Project Structure

```
paillette/
├── apps/
│   ├── api/              # Cloudflare Workers API (Hono)
│   ├── web/              # Remix frontend
│   └── docs/             # Documentation site (future)
├── packages/
│   ├── database/         # D1 schema & migrations
│   ├── ai/               # AI/ML utilities (embeddings, vision)
│   ├── translation/      # Multi-provider translation
│   ├── ui/               # Shared React components
│   ├── types/            # Shared TypeScript types
│   ├── storage/          # R2 storage utilities
│   └── metadata/         # Metadata processing (CSV parsing)
├── tooling/
│   ├── eslint-config/    # Shared ESLint configuration
│   ├── typescript-config/# Shared TypeScript configuration
│   └── vitest-config/    # Shared Vitest configuration
└── docs/
    ├── ARCHITECTURE.md   # System architecture & tech decisions
    ├── ROADMAP.md        # Development roadmap (8 phases)
    └── GETTING_STARTED.md# Setup guide
```

## Development Philosophy

This project follows **Test-Driven Development (TDD)** practices:

- ✅ Write tests first (RED)
- ✅ Implement minimal code to pass (GREEN)
- ✅ Refactor while keeping tests green (REFACTOR)
- ✅ Target: **95%+ test coverage**

### Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Generate coverage report
pnpm test:coverage

# Run E2E tests
cd apps/web && pnpm test:e2e
```

## Development Roadmap

We're following an 8-phase development plan (16-20 weeks):

| Phase | Description | Duration | Status |
|-------|-------------|----------|--------|
| **Phase 0** | Foundation & Setup | 1 week | 🟡 In Progress |
| **Phase 1** | Core Infrastructure & MVP | 2 weeks | ⚪ Planned |
| **Phase 2** | Embedding Generation & Search | 2 weeks | ⚪ Planned |
| **Phase 3** | Metadata Management & Grid View | 1 week | ⚪ Planned |
| **Phase 4** | Color Search & Advanced Filters | 1 week | ⚪ Planned |
| **Phase 5** | Embedding Projector | 2 weeks | ⚪ Planned |
| **Phase 6** | Frame Removal | 1 week | ⚪ Planned |
| **Phase 7** | Multi-Language Translation | 2 weeks | ⚪ Planned |
| **Phase 8** | API & Documentation | 1 week | ⚪ Planned |
| **Phase 9** | Production Readiness | 3 weeks | ⚪ Planned |

**MVP Target**: Phase 3 (Week 6)
**Full Feature Set**: Phase 8 (Week 13)

See [ROADMAP.md](docs/ROADMAP.md) for detailed phase breakdown.

## Key Architectural Decisions

### Why Cloudflare Workers?

- ✅ **Edge Computing**: Sub-50ms latency globally
- ✅ **Integrated AI**: Built-in CLIP models (no external API costs)
- ✅ **Native Vector Search**: Vectorize for similarity search
- ✅ **Zero Egress Fees**: R2 storage with no bandwidth charges
- ✅ **Excellent DX**: Fast cold starts (<1ms), great local dev (Wrangler)

### Why TanStack?

- ✅ **TanStack Query**: Best-in-class data fetching with caching
- ✅ **TanStack Table**: Powerful, headless table component (perfect for artwork grids)
- ✅ **TanStack Virtual**: Virtualization for 10K+ artwork grids

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for full technical details.

## Documentation

- 📖 [Architecture & Technology Decisions](docs/ARCHITECTURE.md)
- 🗺️ [Development Roadmap](docs/ROADMAP.md)
- 🚀 [Getting Started Guide](docs/GETTING_STARTED.md)

## Contributing

We welcome contributions! This project follows TDD practices:

1. Write tests first
2. Ensure 90%+ coverage for new code
3. All tests must pass before merging
4. Follow code standards (enforced by ESLint/Prettier)

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines (coming soon).

## License

To be determined

---

**Built with ❤️ for galleries worldwide, starting with the National Gallery Singapore**
