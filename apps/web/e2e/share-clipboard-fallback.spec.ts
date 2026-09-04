/**
 * The share control when there is no clipboard.
 *
 * `navigator.clipboard` is undefined outside a secure context and can be
 * refused inside one, and the original bug on this control was that the write
 * threw and nothing on screen changed. The unit tests cover the branch in
 * jsdom, but jsdom has no layout and no stylesheet, so it cannot see the thing
 * that was actually wrong here: the field rendered the URL through
 * `.lt-catalogue`, which is `text-transform: uppercase`.
 *
 * That matters because share codes are deliberately case-sensitive. Ctrl+C
 * copies the element's value and survives it, but this field exists for the
 * person who reads the link off the screen and types it somewhere else — and
 * `SFT4685` is not `sfT4685`. Only a real browser with real CSS finds that,
 * which is why this runs against staging rather than in the unit suite.
 *
 *   npx playwright test e2e/share-clipboard-fallback.spec.ts
 */

import { expect, test } from '@playwright/test';

const BASE = process.env.PAILLETTE_BASE_URL ?? 'https://paillette-stg.berlayar.ai';

test.describe('the share control with no clipboard', () => {
  test('hands the link over on screen, in its own case', async ({ page }) => {
    // Exactly what an insecure origin or a denied permission looks like.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        get: () => undefined,
        configurable: true,
      });
    });

    await page.goto(`${BASE}/nga/search?webmcp-debug`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForFunction(() => Boolean((window as any).__paillette_webmcp), null, {
      timeout: 60_000,
    });
    // Tool registration lands a little after the bridge does.
    await page.waitForTimeout(6000);

    const found = await page.evaluate(() =>
      (window as any).__paillette_webmcp.call('search_artworks', {
        query: 'estuary at dusk',
        limit: 4,
      })
    );
    const ids = (found?.results ?? []).map((a: { id: string }) => a.id).slice(0, 3);
    expect(ids.length).toBeGreaterThan(0);

    await page.evaluate(
      (artworkIds) =>
        (window as any).__paillette_webmcp.call('set_results', {
          artworkIds,
          note: 'A show about leaving.',
        }),
      ids
    );
    await page.evaluate(() =>
      (window as any).__paillette_webmcp.call('set_exhibition', {
        title: 'Leaving',
        statement: 'It is about leaving.',
      })
    );

    const button = page.locator('button.paillette-share-link').first();
    await button.waitFor({ timeout: 30_000 });
    await button.click();

    // The word says what happened rather than the control doing nothing.
    await expect(button).toHaveText('Copy failed', { timeout: 30_000 });

    const field = page.locator('input.paillette-share-fallback');
    await expect(field).toBeVisible();

    const url = await field.inputValue();
    expect(url).toMatch(/^https?:\/\/[^/]+\/e\/[^/]+$/);
    await expect(field).toHaveJSProperty('readOnly', true);

    // Focused and fully selected, so the next keystroke is the copy.
    await expect(field).toBeFocused();
    expect(await field.evaluate((n: HTMLInputElement) => n.selectionStart)).toBe(0);
    expect(await field.evaluate((n: HTMLInputElement) => n.selectionEnd)).toBe(url.length);

    /*
     * The regression this file exists for. Anything that uppercases here
     * hands a case-sensitive code to a human in the wrong case.
     */
    expect(
      await field.evaluate((n) => getComputedStyle(n).textTransform)
    ).toBe('none');

    // And the code really is mixed case, so the check above is not vacuous.
    const code = url.split('/e/')[1]!;
    expect(code).not.toBe(code.toUpperCase());

    /*
     * No timer on this path. The success state clears after 2.4s; this one
     * must not, because clearing the link out from under someone mid-drag is
     * the original bug wearing a different coat.
     */
    await page.waitForTimeout(4000);
    await expect(field).toBeVisible();
    await expect(button).toHaveText('Copy failed');
  });
});
