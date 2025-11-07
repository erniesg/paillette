#!/bin/bash
set -e

echo "🚀 Setting up Paillette Staging Infrastructure"
echo "=============================================="
echo ""

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "❌ Error: wrangler CLI not found"
    echo "   Install with: npm install -g wrangler"
    exit 1
fi

# Check if logged in to Cloudflare
if ! wrangler whoami &> /dev/null; then
    echo "❌ Error: Not logged in to Cloudflare"
    echo "   Login with: wrangler login"
    exit 1
fi

echo "✅ Prerequisites check passed"
echo ""

# 1. Create D1 Database
echo "📦 Creating D1 database for staging..."
DB_OUTPUT=$(wrangler d1 create paillette-db-staging --json 2>&1 || echo "exists")
if [[ "$DB_OUTPUT" == *"exists"* ]] || [[ "$DB_OUTPUT" == *"already exists"* ]]; then
    echo "   ℹ️  Database already exists, skipping..."
else
    DB_ID=$(echo "$DB_OUTPUT" | jq -r '.database_id // .id')
    echo "   ✅ Database created: $DB_ID"
    echo "   📝 Update wrangler.toml with this ID"
fi
echo ""

# 2. Create R2 Bucket
echo "🪣 Creating R2 bucket for staging..."
if wrangler r2 bucket create paillette-images-staging 2>&1 | grep -q "already exists"; then
    echo "   ℹ️  Bucket already exists, skipping..."
else
    echo "   ✅ Bucket created: paillette-images-staging"
fi
echo ""

# 3. Create Vectorize Index
echo "🔍 Creating Vectorize index for staging..."
if wrangler vectorize list | grep -q "artwork-embeddings-staging"; then
    echo "   ℹ️  Index already exists, skipping..."
else
    wrangler vectorize create artwork-embeddings-staging \
        --dimensions=1024 \
        --metric=cosine
    echo "   ✅ Index created: artwork-embeddings-staging (1024d, cosine)"
fi
echo ""

# 4. Create KV Namespace
echo "💾 Creating KV namespace for staging..."
KV_OUTPUT=$(wrangler kv:namespace create CACHE --env staging --json 2>&1 || echo "exists")
if [[ "$KV_OUTPUT" == *"exists"* ]] || [[ "$KV_OUTPUT" == *"already exists"* ]]; then
    echo "   ℹ️  KV namespace already exists, skipping..."
else
    KV_ID=$(echo "$KV_OUTPUT" | jq -r '.id')
    echo "   ✅ KV namespace created: $KV_ID"
    echo "   📝 Update wrangler.toml with this ID"
fi
echo ""

# 5. Create Queue
echo "📨 Creating queue for staging..."
if wrangler queues list | grep -q "embedding-jobs-staging"; then
    echo "   ℹ️  Queue already exists, skipping..."
else
    wrangler queues create embedding-jobs-staging
    echo "   ✅ Queue created: embedding-jobs-staging"
fi
echo ""

# 6. Apply Database Migration
echo "🗄️  Applying database migrations..."
if [ -f "../../packages/database/migrations/0001_initial_schema.sql" ]; then
    wrangler d1 execute paillette-db-staging \
        --file=../../packages/database/migrations/0001_initial_schema.sql \
        --env staging
    echo "   ✅ Initial schema migration applied"
else
    echo "   ⚠️  Migration file not found, skipping..."
fi
echo ""

# 7. Summary
echo "=============================================="
echo "✨ Staging infrastructure setup complete!"
echo ""
echo "📋 Next steps:"
echo "   1. Update wrangler.toml with database and KV IDs shown above"
echo "   2. (Optional) Set Replicate API key: wrangler secret put REPLICATE_API_KEY --env staging"
echo "   3. Deploy to staging: npm run wrangler deploy --env staging"
echo "   4. Test: curl https://paillette-stg.workers.dev/health"
echo ""
echo "📚 Resources created:"
echo "   • D1 Database: paillette-db-staging"
echo "   • R2 Bucket: paillette-images-staging"
echo "   • Vectorize: artwork-embeddings-staging"
echo "   • KV Namespace: CACHE (staging)"
echo "   • Queue: embedding-jobs-staging"
echo ""
echo "🎉 Happy deploying!"
