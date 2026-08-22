import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type Request,
  type TestInfo,
} from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  NGA_STAGING_LIVE_REQUEST_BUDGET,
  NgaStagingRequestBudget,
} from './support/nga-staging-request-budget';

const STAGING_ORIGIN = 'https://paillette-stg.berlayar.ai';
const LIVE_PUBLIC_SEARCH_REQUEST_BUDGET = NGA_STAGING_LIVE_REQUEST_BUDGET;
const publicSearchBudget = new NgaStagingRequestBudget<Request>(
  LIVE_PUBLIC_SEARCH_REQUEST_BUDGET
);
type RecordedPublicSearchRequest = {
  url: string;
  method: string;
};
type RecordedFormDataRequest = {
  url: string;
  method: string;
  fields: Record<string, string>;
};

declare global {
  interface Window {
    __ngaStagingFormDataRequests?: RecordedFormDataRequest[];
  }
}

const requestsByPage = new WeakMap<Page, RecordedPublicSearchRequest[]>();
const configuredOrigin = process.env.NGA_STAGING_WEB_BASE_URL || STAGING_ORIGIN;

if (configuredOrigin !== STAGING_ORIGIN) {
  throw new Error(
    `NGA staging browser gate requires exactly ${STAGING_ORIGIN}; received ${configuredOrigin}`
  );
}

const fixtureManifestPath = resolve(
  process.cwd(),
  '../../eval/nga-image-fixtures.json'
);

type PinnedFixture = {
  artworkId: string;
  title: string;
  url: string;
  mimeType: string;
  byteLength: number;
  sha256: string;
};

const fixtureManifest = JSON.parse(
  readFileSync(fixtureManifestPath, 'utf8')
) as { fixtures: PinnedFixture[] };

const attachScreenshot = async (
  page: Page,
  testInfo: TestInfo,
  name: string
) => {
  const attachmentName = `${name}.png`;
  const screenshotPath = testInfo.outputPath(attachmentName);
  await page.screenshot({
    path: screenshotPath,
    fullPage: true,
  });
  await testInfo.attach(attachmentName, {
    path: screenshotPath,
    contentType: 'image/png',
  });
  await unlink(screenshotPath);
};

const downloadFixture = async (
  request: APIRequestContext,
  artworkId: string
) => {
  const fixture = fixtureManifest.fixtures.find(
    (candidate) => candidate.artworkId === artworkId
  );
  if (!fixture) throw new Error(`Unknown pinned fixture: ${artworkId}`);
  const response = await request.get(fixture.url);
  expect(response.status(), `fixture ${artworkId} status`).toBe(200);
  expect(response.headers()['content-type']?.split(';')[0]).toBe(
    fixture.mimeType
  );
  const bytes = await response.body();
  expect(bytes.byteLength).toBe(fixture.byteLength);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(fixture.sha256);
  return { fixture, bytes };
};

const publicSearchRequests = (page: Page) => {
  const requests = requestsByPage.get(page);
  if (!requests) throw new Error('Public-search accounting was not installed.');
  return requests;
};

const installFormDataRecorder = async (page: Page) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.__ngaStagingFormDataRequests = [];
    window.fetch = async (input, init) => {
      if (init?.body instanceof FormData) {
        const fields: Record<string, string> = {};
        for (const [name, value] of init.body.entries()) {
          if (typeof value === 'string') fields[name] = value;
        }
        const inputUrl =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const inputMethod = input instanceof Request ? input.method : 'GET';
        window.__ngaStagingFormDataRequests?.push({
          url: new URL(inputUrl, window.location.href).href,
          method: (init.method || inputMethod).toUpperCase(),
          fields,
        });
      }
      return originalFetch(input, init);
    };
  });
};

const recordedFormDataRequests = (page: Page) =>
  page.evaluate(() => window.__ngaStagingFormDataRequests || []);

const openNga = async (page: Page) => {
  const response = await page.goto('/nga/search');
  expect(response?.url()).toBe(`${STAGING_ORIGIN}/nga/search`);
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole('button', { name: 'Text search mode' })
  ).toBeVisible();
};

const submitText = async (page: Page, query: string) => {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url() === `${STAGING_ORIGIN}/api/public-search/nga/text` &&
      response.request().method() === 'POST'
  );
  await page.getByPlaceholder('search by feeling, era, subject...').fill(query);
  await page.getByRole('button', { name: 'Search text' }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  await expect(
    page.getByRole('button', { name: 'Search settings' })
  ).toBeVisible({
    timeout: 30_000,
  });
};

const waitForImageResponse = (page: Page) =>
  page.waitForResponse(
    (response) =>
      response.url() === `${STAGING_ORIGIN}/api/public-search/nga/image` &&
      response.request().method() === 'POST'
  );

const controlledImageResult = (id: string, title: string) => ({
  success: true,
  data: {
    results: [
      {
        id: `open-access-art:nga:${id}`,
        orgId: 'open-access-art',
        galleryId: 'open-access-art',
        title,
        artist: 'Controlled test artist',
        imageUrl: `https://example.com/${id}.jpg`,
        thumbnailUrl: `https://example.com/${id}-thumb.jpg`,
        similarity: 0.95,
        source: { provider: 'nga' },
        metadata: { provider: 'nga', dominantColors: ['#1a2f52'] },
      },
    ],
    count: 1,
    queryTime: 1,
  },
});

test.describe.serial('anonymous NGA staging browser gate', () => {
  test.afterAll(() => {
    publicSearchBudget.assertLiveWithinBudget();
    const summary = publicSearchBudget.summary();
    expect(summary.mocked).toBe(2);
    expect(summary.live).toBe(LIVE_PUBLIC_SEARCH_REQUEST_BUDGET);
    expect(summary.total).toBe(summary.live + summary.mocked);
  });

  test.beforeEach(async ({ page }) => {
    const requests: RecordedPublicSearchRequest[] = [];
    requestsByPage.set(page, requests);
    page.on('request', (request) => {
      if (!request.url().includes('/api/public-search/')) return;
      publicSearchBudget.observe(request);
      requests.push({
        url: request.url(),
        method: request.method(),
      });
    });
    await installFormDataRecorder(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('pre-upload Image is compact, accessible, truthful, and passive', async ({
    page,
  }, testInfo) => {
    const requests = publicSearchRequests(page);
    await openNga(page);
    await page.getByRole('button', { name: 'Image search mode' }).click();

    await expect(
      page.getByRole('button', { name: 'Image search mode' })
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(
      page.getByRole('region', { name: 'Image search composer' })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Choose image' })
    ).toBeVisible();
    await expect(page.getByText(/JPEG, PNG, or WebP/)).toBeVisible();
    await expect(page.getByText(/10 MiB maximum/)).toBeVisible();
    await expect(
      page.getByLabel('Image for visual artwork search')
    ).toHaveAttribute('aria-describedby', 'image-upload-guidance');
    await expect(
      page.getByRole('button', { name: 'Search settings' })
    ).toHaveCount(0);
    await expect(page.getByText(/No artworks found|No works/)).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(requests).toEqual([]);
    await attachScreenshot(page, testInfo, '01-image-pre-upload');
  });

  test('Text remains the truthful result owner while Image is only being edited', async ({
    page,
  }, testInfo) => {
    const requests = publicSearchRequests(page);
    await openNga(page);
    await submitText(page, 'oil paintings before 1800');
    expect(
      requests.filter(({ url }) => url.endsWith('/nga/text'))
    ).toHaveLength(1);

    await page.getByRole('button', { name: 'Image search mode' }).click();
    await expect(
      page.getByText('Showing Text results until an image is uploaded.')
    ).toBeVisible();
    await expect(page.getByText('Filters kept for image search')).toBeVisible();
    expect(
      requests.filter(({ url }) => url.endsWith('/nga/image'))
    ).toHaveLength(0);
    await attachScreenshot(page, testInfo, '02-text-owned-image-editor');
  });

  test('constrained Image becomes owner and Palette order stays local', async ({
    page,
    request,
  }, testInfo) => {
    const requests = publicSearchRequests(page);
    const { fixture, bytes } = await downloadFixture(
      request,
      'open-access-art:nga:110821'
    );
    await openNga(page);
    await submitText(page, 'oil paintings before 1800');
    await page.getByRole('button', { name: 'Image search mode' }).click();

    const imageResponsePromise = waitForImageResponse(page);
    await page.getByLabel('Image for visual artwork search').setInputFiles({
      name: 'pinned-query.jpg',
      mimeType: fixture.mimeType,
      buffer: bytes,
    });
    const imageResponse = await imageResponsePromise;
    expect(imageResponse.status()).toBe(200);
    expect(imageResponse.headers()['cache-control']).toContain('no-store');
    await expect(
      page.getByRole('button', { name: 'Replace image' })
    ).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByLabel('Image search filters')).toBeVisible();

    const imageRequests = requests.filter(({ url }) =>
      url.endsWith('/nga/image')
    );
    expect(imageRequests).toHaveLength(1);
    const imageFormRequests = (await recordedFormDataRequests(page)).filter(
      ({ url, method }) => url.endsWith('/nga/image') && method === 'POST'
    );
    expect(imageFormRequests).toHaveLength(1);
    expect(
      JSON.parse(imageFormRequests[0]?.fields.constraints || '{}')
    ).toEqual({
      dateRange: { startYear: 1000, endYear: 1799 },
      classifications: ['Painting'],
      mediumFamilies: ['oil'],
    });
    expect(JSON.stringify(imageFormRequests[0]?.fields)).not.toContain(
      'oil paintings before 1800'
    );

    await page.getByRole('button', { name: 'Colour search mode' }).click();
    await page.getByTitle('Navy').click();
    await expect(page.getByText('Palette order: Navy')).toBeVisible();
    expect(
      requests.filter(({ url }) => url.endsWith('/nga/image'))
    ).toHaveLength(1);
    expect(
      requests.filter(({ url }) => url.endsWith('/nga/text'))
    ).toHaveLength(1);
    await attachScreenshot(page, testInfo, '03-image-owner-local-palette');
  });

  test('separate live same-filename image requests execute distinctly', async ({
    page,
    request,
  }, testInfo) => {
    const requests = publicSearchRequests(page);
    const first = await downloadFixture(request, 'open-access-art:nga:131994');
    const second = await downloadFixture(request, 'open-access-art:nga:11236');
    await openNga(page);
    await page.getByRole('button', { name: 'Image search mode' }).click();
    const input = page.getByLabel('Image for visual artwork search');

    const firstResponsePromise = waitForImageResponse(page);
    await input.setInputFiles({
      name: 'same-name.jpg',
      mimeType: first.fixture.mimeType,
      buffer: first.bytes,
    });
    expect((await firstResponsePromise).status()).toBe(200);
    await expect
      .poll(
        () => requests.filter(({ url }) => url.endsWith('/nga/image')).length,
        { timeout: 30_000 }
      )
      .toBe(1);
    const secondResponsePromise = waitForImageResponse(page);
    await input.setInputFiles({
      name: 'same-name.jpg',
      mimeType: second.fixture.mimeType,
      buffer: second.bytes,
    });
    expect((await secondResponsePromise).status()).toBe(200);
    await expect
      .poll(
        () => requests.filter(({ url }) => url.endsWith('/nga/image')).length,
        { timeout: 30_000 }
      )
      .toBe(2);
    await expect(
      page.getByText('same-name.jpg', { exact: true })
    ).toBeVisible();
    await attachScreenshot(page, testInfo, '04-live-same-name');
  });

  test('controlled out-of-order image responses keep replacement result ownership', async ({
    page,
  }, testInfo) => {
    const candidateResultTitle = 'candidate result title';
    const replacementResultTitle = 'replacement result title';
    let requestCount = 0;
    let releaseFirstResponse = () => {};
    let markFirstStarted = () => {};
    let markFirstSettled = () => {};
    let markSecondFulfilled = () => {};
    const firstResponseRelease = new Promise<void>((resolvePromise) => {
      releaseFirstResponse = resolvePromise;
    });
    const firstStarted = new Promise<void>((resolvePromise) => {
      markFirstStarted = resolvePromise;
    });
    const firstSettled = new Promise<void>((resolvePromise) => {
      markFirstSettled = resolvePromise;
    });
    const secondFulfilled = new Promise<void>((resolvePromise) => {
      markSecondFulfilled = resolvePromise;
    });

    await page.route('**/api/public-search/nga/image', async (route) => {
      publicSearchBudget.markMocked(route.request());
      requestCount += 1;
      if (requestCount === 1) {
        markFirstStarted();
        await firstResponseRelease;
        try {
          await route.fulfill({
            status: 200,
            headers: { 'cache-control': 'no-store' },
            json: controlledImageResult('candidate', candidateResultTitle),
          });
        } catch {
          // Cancellation may detach the superseded route. Either outcome must
          // leave the replacement as the sole visible result owner.
        } finally {
          markFirstSettled();
        }
        return;
      }

      await route.fulfill({
        status: 200,
        headers: { 'cache-control': 'no-store' },
        json: controlledImageResult('replacement', replacementResultTitle),
      });
      markSecondFulfilled();
    });

    await openNga(page);
    await page.getByRole('button', { name: 'Image search mode' }).click();
    const input = page.getByLabel('Image for visual artwork search');

    await input.setInputFiles({
      name: 'candidate.png',
      mimeType: 'image/png',
      buffer: Buffer.from([137, 80, 78, 71, 1]),
    });
    await firstStarted;
    await input.setInputFiles({
      name: 'replacement.png',
      mimeType: 'image/png',
      buffer: Buffer.from([137, 80, 78, 71, 2]),
    });
    await secondFulfilled;
    releaseFirstResponse();
    await firstSettled;

    expect(requestCount).toBe(2);
    await expect(
      page.getByText('replacement.png', { exact: true })
    ).toBeVisible();
    await expect(page.getByText('candidate.png', { exact: true })).toHaveCount(
      0
    );
    await expect(
      page.getByText(replacementResultTitle, { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText(candidateResultTitle, { exact: true })
    ).toHaveCount(0);
    await attachScreenshot(
      page,
      testInfo,
      '05-controlled-replacement-ownership'
    );
  });

  test('invalid uploads preserve prior results and expose an alert', async ({
    page,
  }, testInfo) => {
    const requests = publicSearchRequests(page);
    await openNga(page);
    await submitText(page, 'paintings before 1800');
    const textRequestCount = requests.length;
    await page.getByRole('button', { name: 'Image search mode' }).click();
    const input = page.getByLabel('Image for visual artwork search');

    for (const invalid of [
      { name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from('bad') },
      { name: 'empty.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(0) },
      {
        name: 'oversize.jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
      },
    ]) {
      await input.setInputFiles(invalid);
      await expect(page.getByRole('alert')).toBeVisible();
      await expect(
        page.getByText('Showing Text results until an image is uploaded.')
      ).toBeVisible();
      expect(requests).toHaveLength(textRequestCount);
    }
    await attachScreenshot(
      page,
      testInfo,
      '06-invalid-upload-preserves-results'
    );
  });

  test('direct artist attribution returns the pinned primary-artist fixture', async ({
    page,
  }, testInfo) => {
    const requests = publicSearchRequests(page);
    await openNga(page);
    await submitText(page, 'paintings by Lavinia Fontana');

    await expect(page.getByText('By · Lavinia Fontana')).toBeVisible();
    await expect(
      page.getByText('Lucia Bonasoni Garzoni', { exact: true })
    ).toBeVisible({ timeout: 30_000 });
    expect(
      requests.filter(({ url }) => url.endsWith('/nga/text'))
    ).toHaveLength(1);
    await attachScreenshot(page, testInfo, '08-direct-artist-attribution');
  });

  test('derived relation empty state reports unverified catalogue evidence', async ({
    page,
  }, testInfo) => {
    const requests = publicSearchRequests(page);
    await openNga(page);
    await submitText(page, 'photograph used as basis for drawing');

    await expect(
      page.getByText('No catalogue-verified matches.')
    ).toBeVisible();
    await expect(
      page.getByText(
        'The indexed NGA catalogue does not verify this historical relationship.'
      )
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Lower threshold' })
    ).toHaveCount(0);
    expect(
      requests.filter(({ url }) => url.endsWith('/nga/text'))
    ).toHaveLength(1);
    await attachScreenshot(page, testInfo, '09-derived-verified-empty');
  });

  test('NGS stays visibly locked and sends no public-search request', async ({
    page,
  }, testInfo) => {
    const requests = publicSearchRequests(page);
    const response = await page.goto('/ngs/search');
    expect(response?.url()).toBe(`${STAGING_ORIGIN}/ngs/search`);
    await expect(
      page.getByText(
        'Sign in to access National Gallery Singapore collections.'
      )
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Log in to continue' })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Text search mode' })
    ).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Image search mode' })
    ).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Colour search mode' })
    ).toBeDisabled();
    await page.waitForTimeout(500);
    expect(requests).toEqual([]);
    await attachScreenshot(page, testInfo, '07-ngs-locked');
  });
});
