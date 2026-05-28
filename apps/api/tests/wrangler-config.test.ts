import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const wranglerToml = readFileSync(
  new URL('../wrangler.toml', import.meta.url),
  'utf8'
);

const requiredProductionSearchVars = {
  EMBEDDING_INDEX_VERSION: 'v2',
  SEARCH_FUSION_MODE: 'hybrid',
  JINA_MULTIMODAL_MODEL: 'jina-clip-v2',
  JINA_EMBEDDING_DIMENSIONS: '1024',
  CAPTION_VECTOR_SEARCH_ENABLED: 'true',
  CAPTION_EMBEDDING_PROVIDER: 'jina',
  JINA_TEXT_MODEL: 'jina-embeddings-v5-text-small',
  JINA_TEXT_EMBEDDING_DIMENSIONS: '1024',
};

const extractTopLevelVarsBlock = () => {
  const match = wranglerToml.match(/\[vars\]\n([\s\S]*?)\n\n\[/);
  return match?.[1] ?? '';
};

const extractProductionEnvVars = () => {
  const match = wranglerToml.match(
    /\[env\.production\][\s\S]*?vars = \{([^}]+)\}/
  );
  return match?.[1] ?? '';
};

describe('wrangler production search config', () => {
  it('keeps the default production worker on v2 hybrid search', () => {
    const varsBlock = extractTopLevelVarsBlock();

    for (const [key, value] of Object.entries(requiredProductionSearchVars)) {
      expect(varsBlock).toContain(`${key} = "${value}"`);
    }
  });

  it('keeps the named production environment on the same v2 hybrid search config', () => {
    const productionVars = extractProductionEnvVars();

    for (const [key, value] of Object.entries(requiredProductionSearchVars)) {
      expect(productionVars).toContain(`${key} = "${value}"`);
    }
  });
});
