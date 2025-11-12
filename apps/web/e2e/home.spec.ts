import { test, expect } from '@playwright/test';

test.describe('Homepage', () => {
  test('should load homepage successfully', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Paillette/);
  });

  test('should navigate to galleries', async ({ page }) => {
    await page.goto('/');
    const galleriesLink = page.getByRole('link', { name: /galleries/i });
    if (await galleriesLink.isVisible()) {
      await galleriesLink.click();
      await expect(page).toHaveURL(/galleries/);
    }
  });
});
