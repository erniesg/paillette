import { test, expect } from '@playwright/test';

test.describe('Color Search Feature', () => {
  const testGalleryId = 'test-gallery-123';
  const baseUrl = 'http://localhost:5173';

  test.beforeEach(async ({ page }) => {
    // Navigate to color search page
    await page.goto(`${baseUrl}/galleries/${testGalleryId}/color-search`);
  });

  test('should display color search page with header', async ({ page }) => {
    // Check page title
    await expect(page).toHaveTitle(/Color Search - Paillette/);

    // Check header elements
    await expect(page.locator('text=Paillette')).toBeVisible();
    await expect(page.locator('text=Search by Color')).toBeVisible();
    await expect(
      page.locator('text=Find artworks that match specific color palettes')
    ).toBeVisible();
  });

  test('should display color picker with common colors', async ({ page }) => {
    // Check color picker is visible
    await expect(page.locator('text=Selected Colors')).toBeVisible();
    await expect(page.locator('text=Common Colors')).toBeVisible();
    await expect(page.locator('text=Custom Color')).toBeVisible();

    // Check common color palette grid is visible
    const colorButtons = page.locator('button[aria-label^="Select color"]');
    const count = await colorButtons.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should select and deselect colors', async ({ page }) => {
    // Select first color
    const firstColor = page.locator('button[aria-label^="Select color"]').first();
    await firstColor.click();

    // Check color appears in selected colors
    await expect(page.locator('text=/Selected Colors \\(1\\/5\\)/')).toBeVisible();

    // Click again to deselect
    await firstColor.click();

    // Check color is removed
    await expect(page.locator('text=/Selected Colors \\(0\\/5\\)/')).toBeVisible();
  });

  test('should enforce max color limit of 5', async ({ page }) => {
    // Select 5 colors
    const colorButtons = page.locator('button[aria-label^="Select color"]');
    for (let i = 0; i < 5; i++) {
      await colorButtons.nth(i).click();
    }

    // Verify 5 colors selected
    await expect(page.locator('text=/Selected Colors \\(5\\/5\\)/')).toBeVisible();

    // Try to select 6th color - it should replace the last one
    await colorButtons.nth(5).click();

    // Should still have 5 colors
    await expect(page.locator('text=/Selected Colors \\(5\\/5\\)/')).toBeVisible();
  });

  test('should allow custom color input', async ({ page }) => {
    // Find custom color input
    const customColorInput = page.locator('input[type="text"][placeholder="#000000"]');
    await customColorInput.fill('#FF6347');

    // Click add button
    await page.locator('button:has-text("Add")').click();

    // Verify color was added
    await expect(page.locator('text=/Selected Colors \\(1\\/5\\)/')).toBeVisible();
    await expect(page.locator('text=#FF6347')).toBeVisible();
  });

  test('should toggle between ANY and ALL match modes', async ({ page }) => {
    // Check default is ANY
    await expect(page.locator('button:has-text("Match ANY Color")')).toHaveClass(
      /default/
    );

    // Click ALL mode
    await page.locator('button:has-text("Match ALL Colors")').click();

    // Check ALL is now active
    await expect(page.locator('button:has-text("Match ALL Colors")')).toHaveClass(
      /default/
    );

    // Check description changed
    await expect(
      page.locator('text=Find artworks containing all of the selected colors')
    ).toBeVisible();
  });

  test('should show search button disabled when no colors selected', async ({
    page,
  }) => {
    const searchButton = page.locator('button:has-text("Search Artworks")');
    await expect(searchButton).toBeDisabled();
  });

  test('should enable search button when colors are selected', async ({ page }) => {
    // Select a color
    const firstColor = page.locator('button[aria-label^="Select color"]').first();
    await firstColor.click();

    // Check search button is enabled
    const searchButton = page.locator('button:has-text("Search Artworks")');
    await expect(searchButton).toBeEnabled();
  });

  test('should clear all selected colors', async ({ page }) => {
    // Select multiple colors
    const colorButtons = page.locator('button[aria-label^="Select color"]');
    await colorButtons.nth(0).click();
    await colorButtons.nth(1).click();
    await colorButtons.nth(2).click();

    // Verify colors selected
    await expect(page.locator('text=/Selected Colors \\(3\\/5\\)/')).toBeVisible();

    // Click clear all
    await page.locator('button:has-text("Clear All")').click();

    // Verify all colors removed
    await expect(page.locator('text=/Selected Colors \\(0\\/5\\)/')).toBeVisible();
    await expect(
      page.locator('text=Select colors from the palette below')
    ).toBeVisible();
  });

  test('should adjust advanced options', async ({ page }) => {
    // Open advanced options
    await page.locator('summary:has-text("Advanced Options")').click();

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
    // Check all nav links are present
    await expect(page.locator('a:has-text("Dashboard")')).toBeVisible();
    await expect(page.locator('a:has-text("Search")')).toBeVisible();
    await expect(page.locator('a:has-text("Color Search")')).toBeVisible();
    await expect(page.locator('a:has-text("Explore")')).toBeVisible();
    await expect(page.locator('a:has-text("Frame Removal")')).toBeVisible();
    await expect(page.locator('a:has-text("Translate")')).toBeVisible();
  });

  test('should have proper styling and animations', async ({ page }) => {
    // Check gradient background
    const body = page.locator('div.min-h-screen').first();
    await expect(body).toHaveClass(/bg-gradient-to-br/);

    // Select a color and check for animation
    const firstColor = page.locator('button[aria-label^="Select color"]').first();
    await firstColor.click();

    // Check selected color has ring effect
    await expect(firstColor).toHaveClass(/ring-2/);
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
