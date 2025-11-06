# Getting Started with Paillette

This guide will help you set up the Paillette development environment on your local machine.

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** >= 20.0.0 ([Download](https://nodejs.org/))
- **pnpm** >= 9.0.0 ([Install](https://pnpm.io/installation))
- **Git** ([Download](https://git-scm.com/downloads))
- **Wrangler CLI** (Cloudflare Workers CLI)

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/paillette.git
cd paillette
```

### 2. Install Dependencies

```bash
pnpm install
```

This will install all dependencies for all apps and packages in the monorepo.

### 3. Set Up Cloudflare Account

1. Create a [Cloudflare account](https://dash.cloudflare.com/sign-up) if you don't have one
2. Get your Account ID from the Cloudflare dashboard
3. Create an API token with the following permissions:
   - Account → Workers Scripts → Edit
   - Account → Workers KV Storage → Edit
   - Account → D1 → Edit
   - Account → R2 → Edit

### 4. Configure Environment Variables

Create a `.dev.vars` file in `apps/api/`:

```bash
# apps/api/.dev.vars
CLOUDFLARE_ACCOUNT_ID=your-account-id-here
CLOUDFLARE_API_TOKEN=your-api-token-here

# Optional: External API keys (if not using Cloudflare AI)
OPENAI_API_KEY=your-openai-key
REPLICATE_API_TOKEN=your-replicate-token
GOOGLE_TRANSLATE_API_KEY=your-google-key
DEEPL_API_KEY=your-deepl-key
```

Create a `.env` file in `apps/web/`:

```bash
# apps/web/.env
VITE_API_URL=http://localhost:8787/api/v1
```

### 5. Set Up Cloudflare Resources

#### Create D1 Database

```bash
cd apps/api
pnpm wrangler d1 create paillette-db
```

Copy the database ID from the output and update `apps/api/wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "paillette-db"
database_id = "your-database-id-here"  # Replace with your ID
```

Run migrations:

```bash
pnpm db:migrate:local
```

#### Create R2 Bucket

```bash
pnpm wrangler r2 bucket create paillette-images
```

#### Create Vectorize Index

```bash
pnpm wrangler vectorize create artwork-embeddings --dimensions=512 --metric=cosine
```

#### Create KV Namespace

```bash
pnpm wrangler kv:namespace create CACHE
```

Update the namespace ID in `wrangler.toml`.

#### Create Queue

```bash
pnpm wrangler queues create embedding-jobs
```

### 6. Start Development Servers

Open three terminal windows:

**Terminal 1: API (Cloudflare Worker)**
```bash
cd apps/api
pnpm dev
```

The API will be available at `http://localhost:8787`

**Terminal 2: Web (Remix)**
```bash
cd apps/web
pnpm dev
```

The web app will be available at `http://localhost:5173`

**Terminal 3: Watch all packages**
```bash
# From root directory
pnpm dev
```

### 7. Verify Setup

Open your browser and navigate to:
- Web app: http://localhost:5173
- API health check: http://localhost:8787/health

You should see:
- Web app showing the Paillette landing page
- API health check returning a JSON response

## Project Structure

```
paillette/
├── apps/
│   ├── api/              # Cloudflare Workers API
│   ├── web/              # Remix frontend
│   └── docs/             # Documentation site
├── packages/
│   ├── database/         # D1 schema & migrations
│   ├── ai/               # AI/ML utilities
│   ├── translation/      # Translation services
│   ├── ui/               # Shared React components
│   ├── types/            # Shared TypeScript types
│   ├── storage/          # R2 storage utilities
│   └── metadata/         # Metadata processing
├── tooling/
│   ├── eslint-config/    # Shared ESLint config
│   ├── typescript-config/# Shared TS config
│   └── vitest-config/    # Shared Vitest config
└── docs/                 # Architecture & planning docs
```

## Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:coverage

# Run E2E tests
cd apps/web
pnpm test:e2e

# Run E2E tests in UI mode
pnpm test:e2e:ui
```

## Common Commands

```bash
# Development
pnpm dev                # Start all dev servers
pnpm build              # Build all apps/packages
pnpm typecheck          # Type check all packages
pnpm lint               # Lint all packages
pnpm format             # Format code with Prettier

# Testing
pnpm test               # Run all tests
pnpm test:watch         # Watch mode
pnpm test:coverage      # Generate coverage reports

# Database
cd apps/api
pnpm db:migrate:local   # Run migrations locally
pnpm db:generate        # Generate new migration

# Deployment
pnpm deploy:staging     # Deploy to staging
pnpm deploy             # Deploy to production

# Cleanup
pnpm clean              # Clean all build artifacts
```

## Development Workflow

### TDD Approach (Recommended)

1. **RED**: Write a failing test
   ```bash
   # Create test file
   touch packages/ai/src/embedding-service.test.ts

   # Write test
   # Run tests (will fail)
   pnpm test
   ```

2. **GREEN**: Write minimal code to pass the test
   ```bash
   # Implement feature
   # Run tests (should pass)
   pnpm test
   ```

3. **REFACTOR**: Improve code while keeping tests green
   ```bash
   # Refactor code
   # Run tests (should still pass)
   pnpm test
   ```

### Git Workflow

```bash
# Create feature branch
git checkout -b feature/artwork-upload

# Make changes
# Stage changes
git add .

# Commit (pre-commit hooks will run)
git commit -m "feat: add artwork upload functionality"

# Push
git push origin feature/artwork-upload

# Create pull request on GitHub
```

## Troubleshooting

### Issue: Wrangler can't find resources

**Solution**: Make sure you've updated all IDs in `wrangler.toml` after creating resources.

### Issue: Port already in use

**Solution**: Change ports in configuration files or kill existing processes:
```bash
# Find process using port 8787
lsof -ti:8787 | xargs kill -9
```

### Issue: pnpm install fails

**Solution**: Clear cache and reinstall:
```bash
pnpm store prune
rm -rf node_modules
pnpm install
```

### Issue: Tests failing locally but passing in CI

**Solution**: Ensure you have the same Node version as CI:
```bash
node --version  # Should be >= 20.0.0
pnpm --version  # Should be >= 9.0.0
```

### Issue: Cloudflare Workers not updating

**Solution**: Clear wrangler cache:
```bash
rm -rf .wrangler
pnpm dev
```

## Next Steps

1. Read the [Architecture Documentation](./ARCHITECTURE.md)
2. Review the [Development Roadmap](./ROADMAP.md)
3. Check out [Phase 1 Implementation Guide](./phases/PHASE_1.md)
4. Join our [Discord community](https://discord.gg/paillette) (coming soon)

## Getting Help

- **Documentation**: Check the `docs/` directory
- **GitHub Issues**: [Report bugs or request features](https://github.com/yourusername/paillette/issues)
- **Discussions**: [Ask questions](https://github.com/yourusername/paillette/discussions)

## Contributing

We follow a Test-Driven Development (TDD) approach:
- All new features must have tests (min 90% coverage)
- All tests must pass before merging
- Follow the coding standards (enforced by ESLint/Prettier)

See [CONTRIBUTING.md](../CONTRIBUTING.md) for more details.
