import { test, expect } from '@playwright/test';
import { setupApiMocks } from './fixtures/mock-api';

test.describe('Color Search Feature', () => {
  const testGalleryId = 'test-gallery-123';
  const baseUrl = 'http://localhost:5173';

  test.beforeEach(async ({ page }) => {
    // Set up API mocking
    await setupApiMocks(page);

    // Navigate to color search page
    await page.goto(`${baseUrl}/galleries/${testGalleryId}/color-search`);

    // Wait for page to hydrate (framer-motion animations)
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500); // Wait for animations
  });

  test('should display color search page with header', async ({ page }) => {
    // Check page title
    await expect(page).toHaveTitle(/Color Search - Paillette/);

    // Check header elements (use getByRole for better semantics)
    await expect(page.getByRole('link', { name: 'Paillette' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Search by Color' })).toBeVisible();
    await expect(
      page.getByText('Find artworks that match specific color palettes')
    ).toBeVisible();
  });

  test('should display color picker with common colors', async ({ page }) => {
    // Check color picker sections are visible
    await expect(page.getByText(/Selected Colors \(\d+\/5\)/)).toBeVisible();
    await expect(page.getByText('Common Colors')).toBeVisible();
    await expect(page.getByText('Custom Color')).toBeVisible();

    // Check common color palette grid has color buttons
    const colorButtons = page.locator('button[aria-label^="Select color"]');
    await expect(colorButtons.first()).toBeVisible();
    const count = await colorButtons.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should select and deselect colors', async ({ page }) => {
    // Wait for color buttons to be ready
    const firstColor = page.locator('button[aria-label^="Select color"]').first();
    await expect(firstColor).toBeVisible();

    // Select first color
    await firstColor.click();

    // Check color appears in selected colors
    await expect(page.getByText(/Selected Colors \(1\/5\)/)).toBeVisible();

    // Click again to deselect
    await firstColor.click();

    // Check color is removed
    await expect(page.getByText(/Selected Colors \(0\/5\)/)).toBeVisible();
  });

  test('should enforce max color limit of 5', async ({ page }) => {
    // Wait for color buttons to be ready
    const colorButtons = page.locator('button[aria-label^="Select color"]');
    await expect(colorButtons.first()).toBeVisible();

    // Select 5 colors
    for (let i = 0; i < 5; i++) {
      await colorButtons.nth(i).click();
      await page.waitForTimeout(100); // Small delay between clicks
    }

    // Verify 5 colors selected
    await expect(page.getByText(/Selected Colors \(5\/5\)/)).toBeVisible();

    // Try to select 6th color - it should replace the first one
    await colorButtons.nth(5).click();

    // Should still have 5 colors
    await expect(page.getByText(/Selected Colors \(5\/5\)/)).toBeVisible();
  });

  test('should allow custom color input', async ({ page }) => {
    // Find custom color input
    const customColorInput = page.getByPlaceholder('#000000');
    await expect(customColorInput).toBeVisible();

    // Fill in custom color
    await customColorInput.fill('#FF6347');

    // Click add button
    await page.getByRole('button', { name: 'Add' }).click();

    // Verify color was added
    await expect(page.getByText(/Selected Colors \(1\/5\)/)).toBeVisible();
    await expect(page.getByText('#ff6347', { exact: false })).toBeVisible();
  });

  test('should toggle between ANY and ALL match modes', async ({ page }) => {
    // Check default mode description is visible
    await expect(
      page.getByText('Find artworks containing at least one of the selected colors')
    ).toBeVisible();

    // Click ALL mode button
    const allButton = page.getByRole('button', { name: 'Match ALL Colors' });
    await expect(allButton).toBeVisible();
    await allButton.click();

    // Check description changed to ALL mode
    await expect(
      page.getByText('Find artworks containing all of the selected colors')
    ).toBeVisible();

    // Click back to ANY mode
    await page.getByRole('button', { name: 'Match ANY Color' }).click();

    // Check description changed back
    await expect(
      page.getByText('Find artworks containing at least one of the selected colors')
    ).toBeVisible();
  });

  test('should show search button disabled when no colors selected', async ({
    page,
  }) => {
    const searchButton = page.getByRole('button', { name: /Search Artworks/i });
    await expect(searchButton).toBeVisible();
    await expect(searchButton).toBeDisabled();
  });

  test('should enable search button when colors are selected', async ({ page }) => {
    // Wait for and select a color
    const firstColor = page.locator('button[aria-label^="Select color"]').first();
    await expect(firstColor).toBeVisible();
    await firstColor.click();

    // Check search button is enabled
    const searchButton = page.getByRole('button', { name: /Search Artworks/i });
    await expect(searchButton).toBeEnabled();
  });

  test('should clear all selected colors', async ({ page }) => {
    // Wait for color buttons and select multiple colors
    const colorButtons = page.locator('button[aria-label^="Select color"]');
    await expect(colorButtons.first()).toBeVisible();

    await colorButtons.nth(0).click();
    await colorButtons.nth(1).click();
    await colorButtons.nth(2).click();

    // Verify colors selected
    await expect(page.getByText(/Selected Colors \(3\/5\)/)).toBeVisible();

    // Click clear all
    const clearButton = page.getByRole('button', { name: 'Clear All' });
    await expect(clearButton).toBeVisible();
    await clearButton.click();

    // Verify all colors removed
    await expect(page.getByText(/Selected Colors \(0\/5\)/)).toBeVisible();
    await expect(
      page.getByText('Select colors from the palette below')
    ).toBeVisible();
  });

  test('should adjust advanced options', async ({ page }) => {
    // Open advanced options details element
    const advancedOptions = page.getByText('Advanced Options');
    await expect(advancedOptions).toBeVisible();
    await advancedOptions.click();

    // Wait for options to expand
    await page.waitForTimeout(200);

    // Check threshold input
    const thresholdInput = page.locator('input#threshold');
    await expect(thresholdInput).toBeVisible();
    await expect(thresholdInput).toHaveValue('15');

    // Change threshold
    await thresholdInput.fill('25');
    await expect(thresholdInput).toHaveValue('25');

    // Check limit input
    const limitInput = page.locator('input#limit');
    await expect(limitInput).toBeVisible();
    await expect(limitInput).toHaveValue('20');

    // Change limit
    await limitInput.fill('50');
    await expect(limitInput).toHaveValue('50');
  });

  test('should show navigation links in header', async ({ page }) => {
    // Check all nav links are present using semantic selectors
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Search' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Color Search' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Explore' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Frame Removal' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Translate' })).toBeVisible();
  });

  test('should have proper styling and animations', async ({ page }) => {
    // Check gradient background exists
    const mainContainer = page.locator('div.min-h-screen').first();
    await expect(mainContainer).toBeVisible();

    // Verify it has gradient classes
    const classList = await mainContainer.getAttribute('class');
    expect(classList).toContain('bg-gradient-to-br');

    // Select a color and check for visual feedback
    const firstColor = page.locator('button[aria-label^="Select color"]').first();
    await expect(firstColor).toBeVisible();
    await firstColor.click();

    // Wait for animation
    await page.waitForTimeout(300);

    // Check selected color has ring effect
    const selectedClasses = await firstColor.getAttribute('class');
    expect(selectedClasses).toContain('ring-2');
  });

  // Note: The following tests require a live backend API
  // They are skipped by default but documented for manual testing

  test.skip('should perform color search and show results', async ({ page }) => {
    // Select colors
    const colorButtons = page.locator('button[aria-label^="Select color"]');
    await colorButtons.nth(0).click(); // Red
    await colorButtons.nth(5).click(); // Orange

    // Click search
    await page.locator('button:has-text("Search Artworks")').click();

    // Wait for results
    await page.waitForSelector('text=/Found \\d+ artwork/', { timeout: 10000 });

    // Check results are displayed
    await expect(page.locator('[class*="grid"]').first()).toBeVisible();

    // Check artwork cards have color palettes
    await expect(page.locator('div[style*="backgroundColor"]').first()).toBeVisible();
  });

  test.skip('should show loading state during search', async ({ page }) => {
    // Select a color
    const firstColor = page.locator('button[aria-label^="Select color"]').first();
    await firstColor.click();

    // Click search
    await page.locator('button:has-text("Search Artworks")').click();

    // Check loading spinner appears
    await expect(page.locator('text=Searching by color...')).toBeVisible();
    await expect(page.locator('.animate-spin')).toBeVisible();
  });

  test.skip('should show no results message when no matches found', async ({
    page,
  }) => {
    // Select an uncommon color combination
    const customColorInput = page.locator('input[type="text"][placeholder="#000000"]');
    await customColorInput.fill('#ABCDEF');
    await page.locator('button:has-text("Add")').click();

    // Search
    await page.locator('button:has-text("Search Artworks")').click();

    // Wait for results
    await page.waitForTimeout(2000);

    // Check no results message
    await expect(page.locator('text=No artworks found with these colors')).toBeVisible();
    await expect(
      page.locator('text=Try selecting different colors or increasing the similarity threshold')
    ).toBeVisible();
  });
});
