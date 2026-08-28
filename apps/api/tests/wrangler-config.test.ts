import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const wranglerToml = readFileSync(
  new URL('../wrangler.toml', import.meta.url),
  'utf8'
);
const apiIndexSource = readFileSync(
  new URL('../src/index.ts', import.meta.url),
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

const extractStagingEnvVars = () => {
  const match = wranglerToml.match(
    /\[env\.staging\][\s\S]*?vars = \{([^}]+)\}/
  );
  return match?.[1] ?? '';
};

describe('wrangler production search config', () => {
  it('uses WorkOS authenticated search access in every deployment environment', () => {
    expect(extractTopLevelVarsBlock()).toContain(
      'SEARCH_ACCESS_MODE = "authenticated"'
    );
    expect(extractStagingEnvVars()).toContain(
      'SEARCH_ACCESS_MODE = "authenticated"'
    );
    expect(extractProductionEnvVars()).toContain(
      'SEARCH_ACCESS_MODE = "authenticated"'
    );
    for (const secretName of [
      'AUTH_CLIENT_ID',
      'AUTH_ISSUER',
      'AUTH_JWKS_URI',
    ]) {
      expect(apiIndexSource).toContain(`${secretName}?:`);
      expect(wranglerToml).not.toContain(`${secretName} =`);
    }
  });

  it('keeps non-secret MCP protected-resource metadata in each environment', () => {
    expect(extractTopLevelVarsBlock()).toContain(
      'LOGTO_ISSUER = "https://m2fmae.logto.app/oidc"'
    );
    expect(extractTopLevelVarsBlock()).toContain(
      'LOGTO_JWKS_URI = "https://m2fmae.logto.app/oidc/jwks"'
    );
    expect(extractTopLevelVarsBlock()).toContain(
      'LOGTO_API_RESOURCE = "https://paillette-api.berlayar.ai"'
    );
    expect(extractStagingEnvVars()).toContain(
      'LOGTO_ISSUER = "https://m2fmae.logto.app/oidc"'
    );
    expect(extractStagingEnvVars()).toContain(
      'LOGTO_JWKS_URI = "https://m2fmae.logto.app/oidc/jwks"'
    );
    expect(extractStagingEnvVars()).toContain(
      'LOGTO_API_RESOURCE = "https://paillette-api-stg.berlayar.ai"'
    );
    expect(extractProductionEnvVars()).toContain(
      'LOGTO_ISSUER = "https://m2fmae.logto.app/oidc"'
    );
    expect(extractProductionEnvVars()).toContain(
      'LOGTO_JWKS_URI = "https://m2fmae.logto.app/oidc/jwks"'
    );
    expect(extractProductionEnvVars()).toContain(
      'LOGTO_API_RESOURCE = "https://paillette-api.berlayar.ai"'
    );
  });

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

  it('keeps staging on the same v2 hybrid search config as production', () => {
    const stagingVars = extractStagingEnvVars();

    for (const [key, value] of Object.entries(requiredProductionSearchVars)) {
      expect(stagingVars).toContain(`${key} = "${value}"`);
    }
  });
});

describe('wrangler open access asset queue config', () => {
  it('binds open access asset producers and consumers for staging and production', () => {
    expect(wranglerToml).toContain('binding = "OPEN_ACCESS_ASSET_QUEUE"');
    expect(wranglerToml).toContain('queue = "paillette-open-access-assets"');
    expect(wranglerToml).toContain(
      'queue = "paillette-open-access-assets-stg"'
    );
    expect(wranglerToml).toContain('max_batch_size = 25');
    expect(wranglerToml).toContain(
      'dead_letter_queue = "paillette-open-access-assets-dlq"'
    );
    expect(wranglerToml).toContain(
      'dead_letter_queue = "paillette-open-access-assets-dlq-stg"'
    );
  });
});

describe('wrangler D1 migration config', () => {
  it('uses the shared database migrations for top-level, production, and staging D1 bindings', () => {
    const migrationsDir = '../../packages/database/migrations';
    const d1Bindings = wranglerToml.match(
      /\[\[(?:env\.(?:production|staging)\.)?d1_databases\]\][\s\S]*?(?=\n\[\[|\n\[env\.|$)/g
    );

    expect(d1Bindings).toHaveLength(3);

    for (const binding of d1Bindings ?? []) {
      expect(binding).toContain(`migrations_dir = "${migrationsDir}"`);
    }
  });
});
