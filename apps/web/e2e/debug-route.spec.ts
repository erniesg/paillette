import { test } from '@playwright/test';
import { setupApiMocks } from './fixtures/mock-api';

test.describe('Debug Search Page', () => {
  test('check search page tabs', async ({ page }) => {
    // Set up API mocking
    await setupApiMocks(page);

    // Navigate to search
    await page.goto('http://localhost:5173/galleries/test-gallery-123/search');

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Log all button texts
    const allButtons = await page.locator('button').allTextContents();
    console.log('All buttons:', allButtons);

    // Take a screenshot
    await page.screenshot({
      path: '/tmp/search-page-debug.png',
      fullPage: true,
    });

    // Try to find color tab
    const colorButtons = await page.getByText('Color').count();
    console.log('Buttons with "Color" text:', colorButtons);

    // Check for emoji
    const emojiButtons = await page.getByText('🎨').count();
    console.log('Buttons with 🎨:', emojiButtons);
  });
});
