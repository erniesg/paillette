/**
 * The link, opened by a stranger.
 *
 * Every other test in this repo runs against a page that knows things. This
 * one deliberately does not: a fresh context with no storage, no session and
 * no prior visit, opening a URL it was handed — which is the only situation
 * this feature exists for. If it renders here it renders in the message
 * somebody pastes it into.
 *
 * Run against staging with a code that exists:
 *   PAILLETTE_SHARE_CODE=MKwsxHy npx playwright test e2e/cold-share-link.spec.ts
 */

import { expect, test } from '@playwright/test';

const BASE = process.env.PAILLETTE_BASE_URL ?? 'https://paillette-stg.berlayar.ai';
const CODE = process.env.PAILLETTE_SHARE_CODE;

test.describe('a short link opened cold', () => {
  test.skip(!CODE, 'set PAILLETTE_SHARE_CODE to a published exhibition');

  // A fresh context per test: no cookies, no localStorage, nothing carried in.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('renders the whole show to someone with no session', async ({ page }) => {
    const response = await page.goto(`${BASE}/e/${CODE}`, {
      waitUntil: 'domcontentloaded',
    });
    expect(response?.status()).toBe(200);

    // Nothing was carried in, so anything on screen came off the wire.
    const storage = await page.evaluate(() => ({
      local: Object.keys(localStorage).length,
      session: Object.keys(sessionStorage).length,
      cookies: document.cookie,
    }));
    expect(storage.local).toBe(0);
    expect(storage.session).toBe(0);
    expect(storage.cookies).toBe('');

    const title = page.locator('h1.exhibition-title');
    await expect(title).toBeVisible();
    expect((await title.textContent())?.trim().length).toBeGreaterThan(0);

    await expect(page.locator('p.exhibition-statement')).toBeVisible();

    // Every work, every label, and an image that actually decoded — a broken
    // image is the failure this page has had twice before.
    const works = page.locator('li.exhibition-work');
    const count = await works.count();
    expect(count).toBeGreaterThan(0);

    /*
     * Walk the show the way a visitor does, rather than asserting against a
     * page nobody has scrolled.
     *
     * Everything past the second image is `loading="lazy"`, so it decodes on
     * approach. Measured over 24 cold opens: without the scroll a twelve-work
     * show reports 2-9 of 12 decoded and looks broken, and the three- and
     * six-work shows pass anyway because they sit near the fold. So the naive
     * version of this check silently depended on the show being small.
     */
    for (let index = 0; index < count; index += 1) {
      const work = works.nth(index);
      await work.scrollIntoViewIfNeeded();
      await expect(work.locator('.exhibition-work-title')).toBeVisible();
      const image = work.locator('img.exhibition-image');
      await expect(image).toBeVisible();
      await expect(image).toHaveJSProperty('complete', true);
      expect(
        await image.evaluate((node: HTMLImageElement) => node.naturalWidth)
      ).toBeGreaterThan(0);
    }

    // Credit is on the page, not in a footer nobody renders.
    const colophon = page.locator('footer.exhibition-colophon');
    await expect(colophon).toContainText('National Gallery of Art');
    await expect(colophon).toContainText('public domain');
  });

  test('has the tags a paste needs, in the served document', async ({ page }) => {
    await page.goto(`${BASE}/e/${CODE}`, { waitUntil: 'domcontentloaded' });

    const meta = (selector: string) =>
      page.locator(selector).first().getAttribute('content');

    expect(await meta('meta[property="og:title"]')).toBeTruthy();
    expect(await meta('meta[property="og:description"]')).toBeTruthy();
    expect(await meta('meta[name="twitter:card"]')).toBe('summary_large_image');
    expect(await meta('meta[property="og:url"]')).toBe(`${BASE}/e/${CODE}`);
    expect(await meta('meta[property="og:image"]')).toContain('/full/1200,/0/');
    expect(
      await page.locator('link[rel="canonical"]').first().getAttribute('href')
    ).toBe(`${BASE}/e/${CODE}`);
  });

  test('404s a code nobody published', async ({ page }) => {
    const response = await page.goto(`${BASE}/e/zzzzzzz`, {
      waitUntil: 'domcontentloaded',
    });
    expect(response?.status()).toBe(404);
  });

  test('sends a bare /exhibition somewhere useful', async ({ page }) => {
    const response = await page.goto(`${BASE}/exhibition`, {
      waitUntil: 'domcontentloaded',
    });
    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe('/nga/search');
  });
});
