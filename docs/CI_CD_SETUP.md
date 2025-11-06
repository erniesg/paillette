# CI/CD Setup Instructions

## GitHub Actions Workflow

The GitHub Actions workflow could not be automatically pushed due to GitHub App permissions. Here's how to set it up manually:

### Option 1: Create via GitHub Web Interface (Recommended)

1. Go to your repository on GitHub
2. Click **Actions** tab
3. Click **"New workflow"**
4. Click **"set up a workflow yourself"**
5. Copy the workflow content from below
6. Name it `ci.yml`
7. Commit directly to your branch

### Option 2: Create Locally and Push

```bash
# Create the directory
mkdir -p .github/workflows

# Create ci.yml with the content below
# Then commit and push
git add .github/workflows/ci.yml
git commit -m "ci: Add GitHub Actions workflow"
git push
```

---

## Workflow Content

Create `.github/workflows/ci.yml` with this content:

```yaml
name: CI

on:
  push:
    branches: [main, develop, 'claude/**']
  pull_request:
    branches: [main, develop]

env:
  NODE_VERSION: '20'
  PNPM_VERSION: '9.15.0'

jobs:
  install:
    name: Install Dependencies
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

  typecheck:
    name: Type Check
    runs-on: ubuntu-latest
    needs: install
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run type check
        run: pnpm typecheck

  lint:
    name: Lint
    runs-on: ubuntu-latest
    needs: install
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run linter
        run: pnpm lint

  test:
    name: Test
    runs-on: ubuntu-latest
    needs: install
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run tests with coverage
        run: pnpm test:coverage

      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v4
        with:
          files: ./apps/api/coverage/lcov.info,./apps/web/coverage/lcov.info
          flags: unittests
          name: codecov-umbrella
          fail_ci_if_error: false

  build:
    name: Build
    runs-on: ubuntu-latest
    needs: [typecheck, lint, test]
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build all packages
        run: pnpm build
```

---

## Required Secrets

Before the workflow will work properly, add these secrets to your repository:

1. Go to **Settings → Secrets and variables → Actions**
2. Click **"New repository secret"**
3. Add the following:

### Required Secrets:

- `CLOUDFLARE_API_TOKEN` - Your Cloudflare API token
- `CLOUDFLARE_ACCOUNT_ID` - Your Cloudflare account ID

### How to Get These:

1. **Cloudflare API Token**:
   - Go to https://dash.cloudflare.com/profile/api-tokens
   - Click "Create Token"
   - Use the "Edit Cloudflare Workers" template
   - Add permissions for: Workers Scripts, Workers KV, D1, R2

2. **Cloudflare Account ID**:
   - Go to https://dash.cloudflare.com
   - Select any domain (or Workers & Pages)
   - Copy the Account ID from the right sidebar

---

## Optional: Deployment Jobs

If you want automatic deployment to staging/production, add these jobs to the workflow:

### Deploy to Staging (on develop branch)

```yaml
deploy-staging:
  name: Deploy to Staging
  runs-on: ubuntu-latest
  needs: [build, test]
  if: github.ref == 'refs/heads/develop' && github.event_name == 'push'
  environment:
    name: staging
    url: https://staging.paillette.art
  steps:
    - name: Checkout code
      uses: actions/checkout@v4

    - name: Setup pnpm
      uses: pnpm/action-setup@v4
      with:
        version: ${{ env.PNPM_VERSION }}

    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: ${{ env.NODE_VERSION }}
        cache: 'pnpm'

    - name: Install dependencies
      run: pnpm install --frozen-lockfile

    - name: Deploy API to Cloudflare Workers (Staging)
      run: pnpm --filter @paillette/api deploy:staging
      env:
        CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
        CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

    - name: Deploy Web to Cloudflare Pages (Staging)
      run: pnpm --filter @paillette/web deploy:staging
      env:
        CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
        CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

---

## What the CI Pipeline Does

Once set up, the pipeline will:

1. ✅ **Type Check** - Verify all TypeScript types are correct
2. ✅ **Lint** - Run ESLint and Prettier to check code quality
3. ✅ **Test** - Run all unit and integration tests with coverage
4. ✅ **Build** - Verify all apps and packages build successfully
5. ✅ **Deploy** (optional) - Deploy to staging/production

The pipeline runs on:
- Every push to `main`, `develop`, or `claude/**` branches
- Every pull request to `main` or `develop`

---

## Troubleshooting

### "pnpm: command not found"

The pnpm/action-setup@v4 action should install pnpm automatically. If it doesn't, update Node.js setup:

```yaml
- name: Setup pnpm
  run: npm install -g pnpm@9.15.0
```

### "No tests found"

This is normal for Phase 0. Tests will be added in Phase 1. You can temporarily skip the test job or add a placeholder test.

### Secrets not working

Make sure:
1. Secrets are added to the correct repository
2. Secret names match exactly (case-sensitive)
3. You're pushing to a branch that triggers the workflow

---

## Next Steps

1. Create the workflow file (using one of the options above)
2. Add the required secrets
3. Push a commit to test the workflow
4. Watch it run in the **Actions** tab

Once the workflow is running, you'll have:
- Automatic testing on every push
- Code quality enforcement
- Optional automatic deployments
- Coverage reports

For more information, see the main [Getting Started Guide](./GETTING_STARTED.md).
