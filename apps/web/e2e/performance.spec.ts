import { test, expect } from '@playwright/test';

test.describe('Performance Tests', () => {
  test('homepage should load within acceptable time', async ({ page }) => {
    const startTime = Date.now();

    await page.goto('/');

    const loadTime = Date.now() - startTime;

    // Homepage should load in under 3 seconds
    expect(loadTime).toBeLessThan(3000);

    // Check Web Vitals
    const performanceMetrics = await page.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      return {
        domContentLoaded: navigation.domContentLoadedEventEnd - navigation.domContentLoadedEventStart,
        loadComplete: navigation.loadEventEnd - navigation.loadEventStart,
        firstPaint: performance.getEntriesByType('paint').find(e => e.name === 'first-paint')?.startTime || 0,
        firstContentfulPaint: performance.getEntriesByType('paint').find(e => e.name === 'first-contentful-paint')?.startTime || 0,
      };
    });

    console.log('Performance metrics:', performanceMetrics);

    // DOM Content Loaded should be under 1 second
    expect(performanceMetrics.domContentLoaded).toBeLessThan(1000);

    // First Contentful Paint should be under 1.5 seconds
    expect(performanceMetrics.firstContentfulPaint).toBeLessThan(1500);
  });

  test.skip('frame removal page should handle large datasets', async ({ page }) => {
    const startTime = Date.now();

    await page.goto('/galleries/test-gallery-id/frame-removal');

    // Wait for artwork list to load
    await page.waitForSelector('[data-testid="artwork-list"]', { timeout: 10000 });

    const loadTime = Date.now() - startTime;

    // Should load within 5 seconds even with large dataset
    expect(loadTime).toBeLessThan(5000);

    // Check if virtual scrolling is working (should not render all items)
    const renderedItems = await page.locator('[data-testid="artwork-item"]').count();

    // With virtual scrolling, should render only visible items (typically 10-20)
    // Not the full 100+ items
    expect(renderedItems).toBeLessThan(50);
  });

  test.skip('search should be responsive', async ({ page }) => {
    await page.goto('/galleries/test-gallery-id/frame-removal');

    const searchInput = page.getByPlaceholder(/search/i);
    await searchInput.fill('test');

    const startTime = Date.now();

    // Wait for search results to update
    await page.waitForFunction(
      () => {
        const items = document.querySelectorAll('[data-testid="artwork-item"]');
        return items.length > 0;
      },
      { timeout: 2000 }
    );

    const searchTime = Date.now() - startTime;

    // Search should respond within 1 second
    expect(searchTime).toBeLessThan(1000);
  });

  test('api response times should be acceptable', async ({ page, request }) => {
    // Test API endpoint performance
    const startTime = Date.now();

    const response = await request.get('/api/health');

    const responseTime = Date.now() - startTime;

    // API should respond within 200ms
    expect(responseTime).toBeLessThan(200);
    expect(response.ok()).toBeTruthy();
  });
});
