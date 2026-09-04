/**
 * Find a browser driver, on whichever machine this is.
 *
 * Every script under `scripts/demo/` used to carry its own copy of this, and
 * two of the copies were hardcoded paths — one into a laptop's npx cache, one
 * into an exact pnpm store version — so they ran on one machine each and
 * failed at the first import everywhere else. There is no video if the harness
 * does not start.
 *
 * Order: an explicit `PLAYWRIGHT_CORE` (which must exist, or it is a typo
 * worth reporting rather than guessing past), then the workspace's own
 * dependency, then the pnpm store, then npx caches. The *browsers* live in
 * `~/.cache/ms-playwright`, which is Playwright's own default and is left
 * alone unless someone has set `PLAYWRIGHT_BROWSERS_PATH`.
 */

import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

const firstExisting = async (root, toCandidate) => {
  if (!existsSync(root)) return null;
  let entries;
  try {
    entries = await readdir(root);
  } catch {
    return null;
  }
  for (const entry of entries) {
    const candidate = toCandidate(path.join(root, entry), entry);
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
};

export const resolveBrowserDriver = async () => {
  const tried = [];

  const explicit = process.env.PLAYWRIGHT_CORE;
  if (explicit) {
    tried.push(explicit);
    if (!existsSync(explicit)) {
      throw new Error(`PLAYWRIGHT_CORE is set but does not exist: ${explicit}`);
    }
    return await import(pathToFileURL(explicit).href);
  }

  for (const specifier of ['playwright-core', '@playwright/test', 'playwright']) {
    tried.push(specifier);
    try {
      return await import(specifier);
    } catch {
      // Not installed under this resolution root; keep looking.
    }
  }

  const stores = [
    await firstExisting(
      path.join(REPO_ROOT, 'node_modules', '.pnpm'),
      (dir, entry) =>
        entry.startsWith('playwright-core@')
          ? path.join(dir, 'node_modules', 'playwright-core', 'index.mjs')
          : null
    ),
    await firstExisting(path.join(homedir(), '.npm', '_npx'), (dir) =>
      path.join(dir, 'node_modules', 'playwright-core', 'index.mjs')
    ),
  ].filter(Boolean);

  for (const store of stores) {
    tried.push(store);
    return await import(pathToFileURL(store).href);
  }

  throw new Error(
    `Could not find a Playwright driver. Tried:\n  ${tried.join('\n  ')}\n` +
      'Set PLAYWRIGHT_CORE to a playwright-core index.mjs, or install one.'
  );
};

export const { chromium } = await resolveBrowserDriver();
