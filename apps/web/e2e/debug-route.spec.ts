import { test, expect } from '@playwright/test';
import { setupApiMocks } from './fixtures/mock-api';

test.describe('Debug Color Search Route', () => {
  test('check what page actually loads', async ({ page }) => {
    // Set up API mocking
    await setupApiMocks(page);

    // Navigate to color search
    await page.goto('http://localhost:5173/galleries/test-gallery-123/color-search');

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Log the page title
    const title = await page.title();
    console.log('Page title:', title);

    // Log the main heading
    const heading = await page.locator('h1').first().textContent();
    console.log('Main heading:', heading);

    // Log all h1 elements
    const allH1s = await page.locator('h1').allTextContents();
    console.log('All H1s:', allH1s);

    // Log the URL
    console.log('Current URL:', page.url());

    // Take a screenshot
    await page.screenshot({ path: '/tmp/color-search-debug.png', fullPage: true });

    // Check for "Search by Color" text anywhere
    const hasSearchByColor = await page.getByText('Search by Color').count();
    console.log('Has "Search by Color":', hasSearchByColor);

    // Check for "Test Gallery" text
    const hasTestGallery = await page.getByText('Test Gallery').count();
    console.log('Has "Test Gallery":', hasTestGallery);
  });
});
