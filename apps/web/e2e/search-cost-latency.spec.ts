import { expect, test, type Page } from '@playwright/test';
import { PUBLIC_SEARCH_CONTRACT_VERSION } from '@paillette/types/public-search';
import { NGA_SPOTLIGHT_DEFINITIONS } from '../app/lib/nga-spotlight-definitions';
import { NGA_SEARCH_SPOTLIGHT_ASSET_PATH } from '../app/lib/generated-search-spotlight-assets';

const PREVIOUS_PUBLIC_SEARCH_CONTRACT_VERSION = String(
  Number(PUBLIC_SEARCH_CONTRACT_VERSION) - 1
);
const PREVIOUS_NGA_SPOTLIGHT_PATH_PREFIX =
  `/search-spotlights/nga/v${PREVIOUS_PUBLIC_SEARCH_CONTRACT_VERSION}-`;

const card = (id: string) => ({
  id,
  orgId: 'nga',
  title: `Spotlight artwork ${id}`,
  imageUrl: `https://example.com/${id}.jpg`,
  thumbnailUrl: `https://example.com/${id}-thumb.jpg`,
  similarity: 0.9,
  source: {
    provider: 'nga',
    institution: 'National Gallery of Art, Washington',
  },
  palette: ['#4c78a8'],
});

const spotlightBundle = {
  schemaVersion: 1,
  contractVersion: PUBLIC_SEARCH_CONTRACT_VERSION,
  corpusVersion: 'e2e-fixture',
  provider: 'nga',
  generatedAt: '2026-07-17T08:00:00.000Z',
  requestDefaults: { topK: 30, minScore: 0.2 },
  suggestions: NGA_SPOTLIGHT_DEFINITIONS.map((definition) => ({
    ...definition,
    artworks: [1, 2, 3, 4].map((index) => card(`${definition.id}-${index}`)),
  })),
};

type CapturedSearch = {
  url: string;
  method: string;
  body: Record<string, unknown> | string;
};

type SearchHarnessFailures = {
  browse?: string;
  ranked?: string;
};

const searchResult = (
  id: string,
  title: string,
  palette: string[],
  similarity: number
) => ({
  id,
  orgId: 'nga',
  galleryId: 'nga',
  title,
  artist: 'Test artist',
  imageUrl: `https://example.com/${id}.jpg`,
  thumbnailUrl: `https://example.com/${id}-thumb.jpg`,
  similarity,
  metadata: { provider: 'nga', dominantColors: palette },
});

const installSearchHarness = async (
  page: Page,
  results: ReturnType<typeof searchResult>[] = [],
  interpretation?: {
    constraints: Record<string, unknown>;
    originalQuery?: string;
    semanticQuery: string;
  },
  failures: SearchHarnessFailures = {}
) => {
  const searches: CapturedSearch[] = [];
  const spotlightRequests: string[] = [];

  await page.route(`**${NGA_SEARCH_SPOTLIGHT_ASSET_PATH}`, async (route) => {
    spotlightRequests.push(route.request().url());
    await route.fulfill({ json: spotlightBundle });
  });
  await page.route('**/api/public-search/**', async (route) => {
    const request = route.request();
    const contentType = request.headers()['content-type'] || '';
    searches.push({
      url: request.url(),
      method: request.method(),
      body: contentType.includes('application/json')
        ? (request.postDataJSON() as Record<string, unknown>)
        : request.postData() || '',
    });
    const isBrowse = request.url().includes('/browse?');
    const failureMessage = isBrowse ? failures.browse : failures.ranked;
    if (failureMessage) {
      await route.fulfill({
        status: 503,
        json: {
          success: false,
          error: { message: failureMessage },
        },
      });
      return;
    }

    await route.fulfill({
      json: {
        success: true,
        data: isBrowse
          ? {
              results,
              count: results.length,
              total: results.length,
              limit: 60,
              offset: 0,
              hasMore: false,
            }
          : {
              results,
              count: results.length,
              queryTime: 1,
              ...(request.url().endsWith('/text') && interpretation
                ? {
                    interpretation: {
                      parserVersion: 'nga-v6',
                      originalQuery:
                        interpretation.originalQuery ||
                        interpretation.semanticQuery,
                      semanticQuery: interpretation.semanticQuery,
                      constraints: interpretation.constraints,
                      corrections: [],
                      unresolved: [],
                    },
                  }
                : {}),
            },
      },
    });
  });

  return { searches, spotlightRequests };
};

const openNgaSearchPage = async (page: Page) => {
  const response = await page.goto('/nga/search');
  await expect(page.getByLabel('Suggested artworks')).toBeVisible();
  return response;
};

const chooseSuggestion = async (page: Page, label: string) => {
  await page.getByRole('button', { name: 'Choose another suggestion' }).click();
  await page.getByRole('menuitem').filter({ hasText: label }).click();
};

const deferNextImageDigest = async (page: Page) => {
  await page.evaluate(() => {
    const testWindow = window as typeof window & {
      releaseImageDigest?: () => void;
    };
    const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    testWindow.releaseImageDigest = release;
    let shouldWait = true;
    Object.defineProperty(crypto.subtle, 'digest', {
      configurable: true,
      value: async (algorithm: AlgorithmIdentifier, data: BufferSource) => {
        if (shouldWait) {
          shouldWait = false;
          await gate;
        }
        return originalDigest(algorithm, data);
      },
    });
  });
};

const releaseImageDigest = (page: Page) =>
  page.evaluate(() => {
    const testWindow = window as typeof window & {
      releaseImageDigest?: () => void;
    };
    testWindow.releaseImageDigest?.();
  });

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('idle NGA landing preloads one spotlight asset and issues no live searches', async ({
  page,
}) => {
  const { searches, spotlightRequests } = await installSearchHarness(page);
  const observedSpotlightRequests: string[] = [];
  page.on('request', (request) => {
    if (
      new URL(request.url()).pathname.startsWith('/search-spotlights/nga/')
    ) {
      observedSpotlightRequests.push(request.url());
    }
  });

  const documentResponse = await openNgaSearchPage(page);
  expect(documentResponse?.headers()['link']).toContain(
    `<${NGA_SEARCH_SPOTLIGHT_ASSET_PATH}>; rel=preload; as=fetch; crossorigin`
  );
  await expect(
    page.locator('[data-suggestion-query="a stormy sea with ships"]')
  ).toBeVisible();
  await expect(
    page
      .getByLabel('Suggested artworks')
      .getByRole('button', { name: /^View / })
  ).toHaveCount(4);
  await page.waitForTimeout(3_000);

  expect(searches).toEqual([]);
  expect(spotlightRequests).toEqual([
    new URL(NGA_SEARCH_SPOTLIGHT_ASSET_PATH, page.url()).toString(),
  ]);
  expect(observedSpotlightRequests).toEqual([
    new URL(NGA_SEARCH_SPOTLIGHT_ASSET_PATH, page.url()).toString(),
  ]);
  expect(
    observedSpotlightRequests.some((url) =>
      url.includes(PREVIOUS_NGA_SPOTLIGHT_PATH_PREFIX)
    )
  ).toBe(false);
});

test('featured cards remain visible while the full search refreshes', async ({
  page,
}) => {
  let releaseSearch!: () => void;
  const searchGate = new Promise<void>((resolve) => {
    releaseSearch = resolve;
  });
  const searches: CapturedSearch[] = [];

  await page.route(`**${NGA_SEARCH_SPOTLIGHT_ASSET_PATH}`, (route) =>
    route.fulfill({ json: spotlightBundle })
  );
  await page.route('**/api/public-search/**', async (route) => {
    const request = route.request();
    searches.push({
      url: request.url(),
      method: request.method(),
      body: request.postDataJSON() as Record<string, unknown>,
    });
    await searchGate;
    await route.fulfill({
      json: {
        success: true,
        data: {
          results: [searchResult('live', 'Full search result', [], 0.95)],
          count: 1,
          queryTime: 1,
        },
      },
    });
  });

  await openNgaSearchPage(page);
  await chooseSuggestion(page, 'stormy seas and ships');

  await expect.poll(() => searches.length).toBe(1);
  await expect(
    page.getByText('Spotlight artwork stormy-seas-ships-1', { exact: true })
  ).toBeVisible();

  releaseSearch();
  await expect(
    page.getByText('Full search result', { exact: true })
  ).toBeVisible();
});

test('colour suggestion issues one base request with refinement kept client-side', async ({
  page,
}) => {
  const { searches } = await installSearchHarness(page);
  await openNgaSearchPage(page);

  await chooseSuggestion(page, 'blue painted ornament');
  await expect.poll(() => searches.length).toBe(1);
  expect(searches[0]?.body).toMatchObject({
    query: 'blue painted ornament',
    topK: 30,
    minScore: 0.2,
  });
  expect(searches[0]?.body).not.toHaveProperty('visualRefinement');
});

test('metadata suggestion forwards its provider facet', async ({ page }) => {
  const { searches } = await installSearchHarness(page);
  await openNgaSearchPage(page);

  await chooseSuggestion(page, 'paintings across the collection');
  await expect.poll(() => searches.length).toBe(1);
  expect(searches[0]?.body).toMatchObject({
    query: 'Painting',
    facet: 'classification',
  });
});

test('changing or clearing colour on an existing text query only reranks fetched candidates', async ({
  page,
}) => {
  const { searches } = await installSearchHarness(page, [
    searchResult('red', 'Red artwork', ['#bf5631'], 0.95),
    searchResult('blue', 'Blue artwork', ['#1a2f52'], 0.8),
  ]);
  await openNgaSearchPage(page);

  await page
    .getByPlaceholder('search by feeling, era, subject...')
    .fill('two portraits');
  const searchButton = page.getByRole('button', { name: 'Search text' });
  await expect(searchButton).toBeEnabled();
  await searchButton.click();
  await expect.poll(() => searches.length).toBe(1);
  await expect(page.getByText('Red artwork', { exact: true })).toBeVisible();

  await page.getByTitle('Table').click();
  await page.getByTitle('Sort by colour').click();
  await page.getByTitle('Navy').click();
  await expect(page.getByRole('row').nth(1)).toContainText('Blue artwork');
  expect(searches).toHaveLength(1);

  await page.getByTitle('Rust').click();
  await expect(page.getByRole('row').nth(1)).toContainText('Red artwork');
  expect(searches).toHaveLength(1);

  await page.getByRole('button', { name: 'Clear Rust colour target' }).click();
  expect(searches).toHaveLength(1);
});

test('passive Image editor is accessible and performs no public search', async ({
  page,
}) => {
  const { searches } = await installSearchHarness(page);
  await openNgaSearchPage(page);

  await page.getByRole('button', { name: 'Image search mode' }).click();

  await expect(
    page.getByRole('button', { name: 'Image search mode' })
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('button', { name: 'Choose image' })
  ).toBeVisible();
  await expect(page.getByText(/JPEG, PNG, or WebP/)).toBeVisible();
  await expect(page.getByText(/10 MiB/)).toBeVisible();
  await expect(
    page.getByLabel('Image for visual artwork search')
  ).toHaveAttribute('aria-describedby');
  await expect(page.getByText(/No artworks found|No works|Ready/)).toHaveCount(
    0
  );
  await expect(
    page.getByRole('button', { name: 'Search settings' })
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Choose another suggestion' })
  ).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(searches).toHaveLength(0);
});

test('editing Image preserves completed Text results until upload', async ({
  page,
}) => {
  const { searches } = await installSearchHarness(page, [
    searchResult('painting', 'Preserved painting', ['#1a2f52'], 0.91),
  ]);
  await openNgaSearchPage(page);
  await page
    .getByPlaceholder('search by feeling, era, subject...')
    .fill('paintings before 1800');
  await page.getByRole('button', { name: 'Search text' }).click();
  await expect(
    page.getByText('Preserved painting', { exact: true })
  ).toBeVisible();

  await page.getByRole('button', { name: 'Image search mode' }).click();

  await expect(
    page.getByText('Preserved painting', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('Showing Text results until an image is uploaded.')
  ).toBeVisible();
  expect(searches).toHaveLength(1);
});

test('upload submits exactly one digest-owned image request without semantic text', async ({
  page,
}) => {
  const { searches } = await installSearchHarness(
    page,
    [searchResult('visual', 'Visual match', ['#1a2f52'], 0.91)],
    {
      originalQuery: 'oil paintings before 1800',
      semanticQuery: 'oil paintings',
      constraints: {
        dateRange: { startYear: 1700, endYear: 1799 },
        classifications: ['Painting'],
        mediumFamilies: ['oil'],
      },
    }
  );
  await openNgaSearchPage(page);
  await page
    .getByPlaceholder('search by feeling, era, subject...')
    .fill('oil paintings before 1800');
  await page.getByRole('button', { name: 'Search text' }).click();
  await expect.poll(() => searches.length).toBe(1);
  await page.getByRole('button', { name: 'Image search mode' }).click();
  await expect(page.getByText('Filters kept for image search')).toBeVisible();

  await page.getByLabel('Image for visual artwork search').setInputFiles({
    name: 'query.png',
    mimeType: 'image/png',
    buffer: Buffer.from([137, 80, 78, 71, 1, 2, 3, 4]),
  });

  await expect
    .poll(() => searches.filter(({ url }) => url.endsWith('/image')).length)
    .toBe(1);
  const imageSearch = searches.find(({ url }) => url.endsWith('/image'));
  expect(imageSearch?.body).toMatch(/name="minScore"\r\n\r\n0\.2/);
  expect(imageSearch?.body).toContain(
    '{"dateRange":{"startYear":1700,"endYear":1799},"classifications":["Painting"],"mediumFamilies":["oil"]}'
  );
  expect(imageSearch?.body).not.toContain('oil paintings before 1800');
  await expect(page.getByText('Visual match', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Replace image' })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Remove image' })
  ).toBeVisible();
});

test('same filename with changed bytes submits a new image query', async ({
  page,
}) => {
  const { searches } = await installSearchHarness(page);
  await openNgaSearchPage(page);
  await page.getByRole('button', { name: 'Image search mode' }).click();
  const input = page.getByLabel('Image for visual artwork search');

  await input.setInputFiles({
    name: 'same.png',
    mimeType: 'image/png',
    buffer: Buffer.from([137, 80, 78, 71, 1]),
  });
  await expect.poll(() => searches.length).toBe(1);
  await input.setInputFiles({
    name: 'same.png',
    mimeType: 'image/png',
    buffer: Buffer.from([137, 80, 78, 71, 2]),
  });

  await expect.poll(() => searches.length).toBe(2);
});

test('explicitly resubmitting the same image bytes performs one fresh request', async ({
  page,
}) => {
  const { searches } = await installSearchHarness(page);
  await openNgaSearchPage(page);
  await page.getByRole('button', { name: 'Image search mode' }).click();
  const input = page.getByLabel('Image for visual artwork search');
  const bytes = Buffer.from([137, 80, 78, 71, 9]);

  await input.setInputFiles({
    name: 'first.png',
    mimeType: 'image/png',
    buffer: bytes,
  });
  await expect.poll(() => searches.length).toBe(1);
  await input.setInputFiles({
    name: 'renamed.png',
    mimeType: 'image/png',
    buffer: bytes,
  });

  await expect.poll(() => searches.length).toBe(2);
});

test('superseding a pending image over Text clears the candidate and preserves Text ownership', async ({
  page,
}) => {
  const { searches } = await installSearchHarness(page, [
    searchResult('painting', 'Preserved painting', ['#1a2f52'], 0.91),
  ]);
  await openNgaSearchPage(page);
  await page
    .getByPlaceholder('search by feeling, era, subject...')
    .fill('paintings');
  await page.getByRole('button', { name: 'Search text' }).click();
  await expect.poll(() => searches.length).toBe(1);
  await page.getByRole('button', { name: 'Image search mode' }).click();
  await deferNextImageDigest(page);

  await page.getByLabel('Image for visual artwork search').setInputFiles({
    name: 'candidate.png',
    mimeType: 'image/png',
    buffer: Buffer.from([137, 80, 78, 71, 4]),
  });
  await expect(page.getByText('candidate.png', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Text search mode' }).click();
  await releaseImageDigest(page);
  await page.getByRole('button', { name: 'Image search mode' }).click();

  await expect(page.getByText('candidate.png', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Choose image', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Preserved painting', { exact: true })
  ).toBeVisible();
  expect(searches).toHaveLength(1);
});

test('superseding a replacement candidate restores the accepted Image preview', async ({
  page,
}) => {
  const { searches } = await installSearchHarness(page, [
    searchResult('visual', 'Accepted visual match', ['#1a2f52'], 0.91),
  ]);
  await openNgaSearchPage(page);
  await page.getByRole('button', { name: 'Image search mode' }).click();
  const input = page.getByLabel('Image for visual artwork search');
  await input.setInputFiles({
    name: 'accepted.png',
    mimeType: 'image/png',
    buffer: Buffer.from([137, 80, 78, 71, 1]),
  });
  await expect.poll(() => searches.length).toBe(1);
  await deferNextImageDigest(page);
  await input.setInputFiles({
    name: 'candidate.png',
    mimeType: 'image/png',
    buffer: Buffer.from([137, 80, 78, 71, 2]),
  });
  await expect(page.getByText('candidate.png', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Image search mode' }).click();
  await releaseImageDigest(page);

  await expect(page.getByText('accepted.png', { exact: true })).toBeVisible();
  await expect(page.getByText('candidate.png', { exact: true })).toHaveCount(0);
  await expect(
    page.getByText('Accepted visual match', { exact: true })
  ).toBeVisible();
  expect(searches).toHaveLength(1);
});

test('Browse success retries the displayed ranked failure', async ({
  page,
}) => {
  const { searches } = await installSearchHarness(page, [], undefined, {
    ranked: 'Ranked failed',
  });
  await openNgaSearchPage(page);
  await page
    .getByPlaceholder('search by feeling, era, subject...')
    .fill('paintings');
  await page.getByRole('button', { name: 'Search text' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Search settings' }).click();
  await page.getByRole('button', { name: /Infinite browse/ }).click();
  await expect
    .poll(() => searches.filter(({ url }) => url.includes('/browse?')).length)
    .toBe(1);

  await page.getByRole('button', { name: 'Try again' }).click();

  await expect
    .poll(() => searches.filter(({ url }) => url.endsWith('/text')).length)
    .toBe(2);
  expect(searches.filter(({ url }) => url.includes('/browse?'))).toHaveLength(
    1
  );
});

test('Browse failure takes display and retry precedence when ranked also fails', async ({
  page,
}) => {
  const { searches } = await installSearchHarness(page, [], undefined, {
    browse: 'Browse failed',
    ranked: 'Ranked failed',
  });
  await openNgaSearchPage(page);
  await page
    .getByPlaceholder('search by feeling, era, subject...')
    .fill('paintings');
  await page.getByRole('button', { name: 'Search text' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Search settings' }).click();
  await page.getByRole('button', { name: /Infinite browse/ }).click();
  await expect
    .poll(() => searches.filter(({ url }) => url.includes('/browse?')).length)
    .toBe(1);

  await page.getByRole('button', { name: 'Try again' }).click();

  await expect
    .poll(() => searches.filter(({ url }) => url.includes('/browse?')).length)
    .toBe(2);
  expect(searches.filter(({ url }) => url.endsWith('/text'))).toHaveLength(1);
});

test('image upload rejection preserves results and reports an accessible error', async ({
  page,
}) => {
  const { searches } = await installSearchHarness(page, [
    searchResult('painting', 'Preserved painting', ['#1a2f52'], 0.91),
  ]);
  await openNgaSearchPage(page);
  await page
    .getByPlaceholder('search by feeling, era, subject...')
    .fill('paintings');
  await page.getByRole('button', { name: 'Search text' }).click();
  await page.getByRole('button', { name: 'Image search mode' }).click();

  await page.getByLabel('Image for visual artwork search').setInputFiles({
    name: 'empty.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc(0),
  });

  await expect(page.getByRole('alert')).toContainText('must not be empty');
  await expect(
    page.getByText('Preserved painting', { exact: true })
  ).toBeVisible();
  expect(searches).toHaveLength(1);
});

test('Colour over image results is visibly local and performs no request', async ({
  page,
}) => {
  const { searches } = await installSearchHarness(page, [
    searchResult('visual', 'Visual match', ['#1a2f52'], 0.91),
  ]);
  await openNgaSearchPage(page);
  await page.getByRole('button', { name: 'Image search mode' }).click();
  await page.getByLabel('Image for visual artwork search').setInputFiles({
    name: 'query.png',
    mimeType: 'image/png',
    buffer: Buffer.from([137, 80, 78, 71, 1]),
  });
  await expect.poll(() => searches.length).toBe(1);

  await page.getByRole('button', { name: 'Colour search mode' }).click();
  await page.getByTitle('Navy').click();

  await expect(page.getByText('Palette order: Navy')).toBeVisible();
  expect(searches).toHaveLength(1);
});
