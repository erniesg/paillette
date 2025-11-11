# @paillette/translation

Multi-provider translation service for the Paillette platform, optimized for art gallery content with support for English, Mandarin Chinese, Malay, and Tamil.

## Features

- **Multi-provider routing**: Automatically routes to best provider per language pair
- **Smart fallbacks**: Falls back to Cloudflare AI if primary providers fail
- **KV caching**: Caches translations for 30 days to reduce costs
- **Cost tracking**: Tracks and reports translation costs per request
- **Art context**: Optimized for art gallery and museum content

## Supported Providers

### Primary Providers (Language-Specific)

1. **Youdao** - Best for Chinese translations
   - Languages: EN ↔ ZH
   - Specialization: Cultural context and idioms
   - Cost: ~$0.00001/char

2. **OpenAI GPT-4o-mini** - Best for Malay translations
   - Languages: EN ↔ MS (and all others)
   - Specialization: Art terminology and Southeast Asian context
   - Cost: ~$0.00003/char

3. **Google Translate V2** - Best for Tamil translations
   - Languages: EN ↔ TA (and all others)
   - Specialization: Excellent Tamil language support
   - Cost: ~$0.00002/char

### Fallback Provider

4. **Cloudflare AI** - Free tier fallback
   - Languages: All supported pairs
   - Specialization: General translation
   - Cost: Free

## Installation

```bash
pnpm install @paillette/translation
```

## Usage

### Initialize Service

```typescript
import { TranslationService } from '@paillette/translation';

const translationService = new TranslationService({
  ai: env.AI,                          // Required: Cloudflare AI binding
  cache: env.CACHE,                    // Optional: KV namespace for caching
  cacheTTL: 2592000,                   // Optional: Cache TTL (default 30 days)
  openaiApiKey: env.OPENAI_API_KEY,    // Optional: OpenAI API key
  youdaoAppKey: env.YOUDAO_APP_KEY,    // Optional: Youdao app key
  youdaoAppSecret: env.YOUDAO_APP_SECRET, // Optional: Youdao app secret
  googleApiKey: env.GOOGLE_TRANSLATE_API_KEY, // Optional: Google API key
});
```

### Translate Text

```typescript
const result = await translationService.translate(
  'The Starry Night is a masterpiece by Vincent van Gogh.',
  'en',  // source language
  'zh'   // target language
);

console.log(result);
// {
//   translatedText: '星夜是梵高的杰作。',
//   provider: 'youdao',
//   cached: false,
//   cost: 0.00053
// }
```

### Batch Translation

```typescript
const texts = [
  'Impressionism began in 19th century France.',
  'The artwork depicts a rural landscape.',
  'This painting uses bold brushstrokes.'
];

const results = await translationService.translateBatch(texts, 'en', 'ms');
```

### Cost Estimation

```typescript
const estimate = translationService.estimateCost(
  'A long text to translate...',
  'zh'
);

console.log(estimate);
// {
//   provider: 'youdao',
//   cost: 0.00123
// }
```

## Provider Routing Strategy

The service automatically selects the optimal provider based on target language:

| Target Language | Primary Provider | Fallback |
|----------------|------------------|----------|
| Chinese (zh)   | Youdao           | OpenAI → Cloudflare AI |
| Malay (ms)     | OpenAI           | Cloudflare AI |
| Tamil (ta)     | Google Translate | OpenAI → Cloudflare AI |
| English (en)   | OpenAI           | Cloudflare AI |

## Configuration

### Environment Variables

```bash
# Required
CLOUDFLARE_AI=<bound via wrangler.toml>
CLOUDFLARE_CACHE=<bound via wrangler.toml>

# Optional (for better quality)
OPENAI_API_KEY=sk-...
YOUDAO_APP_KEY=...
YOUDAO_APP_SECRET=...
GOOGLE_TRANSLATE_API_KEY=...
```

### Wrangler Configuration

```toml
[ai]
binding = "AI"

[[kv_namespaces]]
binding = "CACHE"
id = "your-kv-namespace-id"

[vars]
OPENAI_API_KEY = "..."
YOUDAO_APP_KEY = "..."
YOUDAO_APP_SECRET = "..."
GOOGLE_TRANSLATE_API_KEY = "..."
```

## Error Handling

```typescript
try {
  const result = await translationService.translate(text, 'en', 'zh');
} catch (error) {
  if (error instanceof TranslationError) {
    console.error('Translation failed:', error.message);
    console.error('Provider:', error.provider);
    console.error('Error code:', error.code);
  }
}
```

## Caching

Translations are automatically cached in KV storage with the following key format:

```
translation:{text_hash}:{source_lang}:{target_lang}
```

Cache TTL is configurable (default 30 days). Cached translations return immediately without API calls.

## Cost Optimization

1. **Caching**: Repeated translations are free
2. **Provider selection**: Uses cheapest provider per language
3. **Batch processing**: Efficient for multiple translations
4. **Cloudflare AI fallback**: Free tier when others fail

### Example Cost Breakdown (1000 characters)

- Youdao (Chinese): ~$0.01
- Google (Tamil): ~$0.02
- OpenAI (Malay): ~$0.03
- Cloudflare AI: Free

## Development

```bash
# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Type checking
pnpm typecheck
```

## Architecture

```
TranslationService
├── Provider Selection (by target language)
├── Primary Provider (Youdao/OpenAI/Google)
│   ├── Success → Cache → Return
│   └── Failure → Fallback
├── Fallback Provider (Cloudflare AI)
│   ├── Success → Cache → Return
│   └── Failure → Error
└── Cache Lookup (before providers)
```

## Limitations

- Maximum text length: 50,000 characters
- Supported languages: en, zh, ms, ta
- Cloudflare Workers runtime (no Node.js dependencies)

## Future Enhancements

- [ ] Add more language pairs
- [ ] Support for HTML/Markdown preservation
- [ ] Glossary/terminology management
- [ ] Translation memory
- [ ] Quality scoring and validation

## License

Private - Paillette Platform
