import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const STAGING_ORIGIN = 'https://paillette-stg.berlayar.ai';
const configuredOrigin = process.env.NGA_STAGING_WEB_BASE_URL || STAGING_ORIGIN;

if (configuredOrigin !== STAGING_ORIGIN) {
  throw new Error(
    `NGA staging browser gate requires exactly ${STAGING_ORIGIN}; received ${configuredOrigin}`
  );
}

const evidenceDirectory = resolve(
  process.env.NGA_STAGING_EVIDENCE_DIR || 'test-results/nga-staging-gate'
);
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

const screenshot = async (page: Page, name: string) => {
  await mkdir(evidenceDirectory, { recursive: true });
  await page.screenshot({
    path: resolve(evidenceDirectory, `${name}.png`),
    fullPage: true,
  });
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
  const requests: Array<{
    url: string;
    method: string;
    postData: string | null;
  }> = [];
  page.on('request', (request) => {
    if (!request.url().includes('/api/public-search/')) return;
    requests.push({
      url: request.url(),
      method: request.method(),
      postData: request.postData(),
    });
  });
  return requests;
};

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

test.describe.serial('anonymous NGA staging browser gate', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('pre-upload Image is compact, accessible, truthful, and passive', async ({
    page,
  }) => {
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
    await screenshot(page, '01-image-pre-upload');
  });

  test('Text remains the truthful result owner while Image is only being edited', async ({
    page,
  }) => {
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
    await screenshot(page, '02-text-owned-image-editor');
  });

  test('constrained Image becomes owner and Palette order stays local', async ({
    page,
    request,
  }) => {
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
    expect(imageRequests[0]?.postData).toContain(
      '"classifications":["Painting"]'
    );
    expect(imageRequests[0]?.postData).toContain('"mediumFamilies":["oil"]');
    expect(imageRequests[0]?.postData).toContain('"endYear":1799');
    expect(imageRequests[0]?.postData).not.toContain(
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
    await screenshot(page, '03-image-owner-local-palette');
  });

  test('same filename different bytes executes distinctly and replacement wins', async ({
    page,
    request,
  }) => {
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

    // A digest still in preparation is superseded by the next selection. The
    // final preview and result owner must be the replacement, never stale work.
    await input.setInputFiles({
      name: 'candidate.jpg',
      mimeType: first.fixture.mimeType,
      buffer: first.bytes,
    });
    await input.setInputFiles({
      name: 'replacement.jpg',
      mimeType: second.fixture.mimeType,
      buffer: second.bytes,
    });
    await expect(
      page.getByText('replacement.jpg', { exact: true })
    ).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText('candidate.jpg', { exact: true })).toHaveCount(
      0
    );
    await screenshot(page, '04-same-name-and-replacement');
  });

  test('invalid uploads preserve prior results and expose an alert', async ({
    page,
  }) => {
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
    await screenshot(page, '05-invalid-upload-preserves-results');
  });

  test('NGS stays visibly locked and sends no public-search request', async ({
    page,
  }) => {
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
    await screenshot(page, '06-ngs-locked');
  });
});
