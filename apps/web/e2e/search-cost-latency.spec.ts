import { expect, test, type Page } from '@playwright/test';
import { NGA_SPOTLIGHT_DEFINITIONS } from '../app/lib/nga-spotlight-definitions';

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
  contractVersion: '26',
  corpusVersion: 'e2e-fixture',
  provider: 'nga',
  generatedAt: '2026-07-17T08:00:00.000Z',
  requestDefaults: { topK: 30, minScore: 0.2 },
  suggestions: NGA_SPOTLIGHT_DEFINITIONS.map((definition) => ({
    ...definition,
    artworks: [1, 2, 3, 4].map((index) =>
      card(`${definition.id}-${index}`)
    ),
  })),
};

type CapturedSearch = {
  url: string;
  body: Record<string, unknown>;
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
  results: ReturnType<typeof searchResult>[] = []
) => {
  const searches: CapturedSearch[] = [];
  const spotlightRequests: string[] = [];

  await page.route('**/search-spotlights/nga/v26-*.json', async (route) => {
    spotlightRequests.push(route.request().url());
    await route.fulfill({ json: spotlightBundle });
  });
  await page.route('**/api/public-search/**', async (route) => {
    const request = route.request();
    searches.push({
      url: request.url(),
      body: request.postDataJSON() as Record<string, unknown>,
    });
    await route.fulfill({
      json: {
        success: true,
        data: { results, count: results.length, queryTime: 1 },
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

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('idle NGA landing preloads one spotlight asset and issues no live searches', async ({
  page,
}) => {
  const searches: string[] = [];
  const spotlightRequests: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/api/public-search/')) searches.push(url);
    if (url.includes('/search-spotlights/nga/v26-')) {
      spotlightRequests.push(url);
    }
  });

  const documentResponse = await openNgaSearchPage(page);
  expect(documentResponse?.headers()['link']).toMatch(
    /<\/search-spotlights\/nga\/v26-[a-f0-9]{64}\.json>; rel=preload; as=fetch; crossorigin/
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
  expect(spotlightRequests).toHaveLength(1);
  expect(spotlightRequests[0]).toMatch(
    /\/search-spotlights\/nga\/v26-[a-f0-9]{64}\.json$/
  );
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
