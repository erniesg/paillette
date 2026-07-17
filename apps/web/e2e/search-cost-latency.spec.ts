import { expect, test, type Page } from '@playwright/test';

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

const suggestion = (
  id: string,
  type: 'motif' | 'metadata' | 'colour',
  label: string,
  query: string,
  extras: Record<string, string> = {}
) => ({
  id,
  type,
  label,
  query,
  dot: '#4c78a8',
  ...extras,
  artworks: [1, 2, 3, 4].map((index) => card(`${id}-${index}`)),
});

const spotlightBundle = {
  schemaVersion: 1,
  contractVersion: '18',
  corpusVersion: 'e2e-fixture',
  provider: 'nga',
  generatedAt: '2026-07-17T08:00:00.000Z',
  requestDefaults: { topK: 30, minScore: 0.2 },
  suggestions: [
    suggestion(
      'stormy-seas-ships',
      'motif',
      'stormy seas and ships',
      'a stormy sea with ships'
    ),
    suggestion(
      'paintings-collection',
      'metadata',
      'paintings across the collection',
      'Painting',
      { facet: 'classification' }
    ),
    suggestion(
      'blue-painted-ornament',
      'colour',
      'blue painted ornament',
      'blue painted ornament',
      { colourId: 'custom:#4c78a8' }
    ),
  ],
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

  await page.route('**/search-spotlights/nga/v18-*.json', async (route) => {
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

  return searches;
};

const chooseSuggestion = async (page: Page, label: string) => {
  await page.getByRole('button', { name: 'Choose another suggestion' }).click();
  await page.getByRole('menuitem').filter({ hasText: label }).click();
};

test('idle NGA landing and spotlight rotation issue no live search requests', async ({
  page,
}) => {
  const searches = await installSearchHarness(page);

  const documentResponse = await page.goto('/nga/search');
  expect(documentResponse?.headers()['link']).toMatch(
    /<\/search-spotlights\/nga\/v18-[a-f0-9]{64}\.json>; rel=preload; as=fetch; crossorigin/
  );
  await expect(
    page.locator('[data-suggestion-query="a stormy sea with ships"]')
  ).toBeVisible();
  await page.waitForTimeout(3_000);

  expect(searches).toEqual([]);
});

test('suggestion clicks issue one base request with facet and colour kept client-side', async ({
  page,
}) => {
  const searches = await installSearchHarness(page);
  await page.goto('/nga/search');

  await chooseSuggestion(page, 'blue painted ornament');
  await expect.poll(() => searches.length).toBe(1);
  expect(searches[0]?.body).toMatchObject({
    query: 'blue painted ornament',
    topK: 30,
    minScore: 0.2,
  });
  expect(searches[0]?.body).not.toHaveProperty('visualRefinement');

  await page.goto('/nga/search');
  searches.length = 0;
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
  const searches = await installSearchHarness(page, [
    searchResult('red', 'Red artwork', ['#bf5631'], 0.95),
    searchResult('blue', 'Blue artwork', ['#1a2f52'], 0.8),
  ]);
  await page.goto('/nga/search');

  await page
    .getByPlaceholder('search by feeling, era, subject...')
    .fill('two portraits');
  await page.getByRole('button', { name: 'Search text' }).click();
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
