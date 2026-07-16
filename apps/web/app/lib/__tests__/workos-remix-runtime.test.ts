import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('WorkOS Remix runtime contract', () => {
  it('enables single-fetch so AuthKit loader data is interpreted by Remix', () => {
    const viteConfig = readFileSync('vite.config.ts', 'utf8');

    expect(viteConfig).toMatch(/v3_singleFetch:\s*true/);
  });
});
