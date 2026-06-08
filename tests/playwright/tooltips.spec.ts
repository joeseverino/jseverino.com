import { test, expect } from '@playwright/test';

test.describe('Private Tooltip Interactive Verification', () => {
  test('renders, positions, and dismisses tooltips correctly', async ({ page }) => {
    // Navigate to the writeup page that has a private link
    await page.goto('/portfolio/building-a-custom-mcp-layer/');
    await page.waitForLoadState('networkidle');

    // Locate the private tooltip trigger link
    const trigger = page.locator('[data-private-tooltip]');
    await expect(trigger).toBeVisible();
    await expect(trigger).toContainText('Severino HQ');

    // Tooltip should not be in the DOM initially
    const tooltipSelector = '.private-tooltip';
    await expect(page.locator(tooltipSelector)).toHaveCount(0);

    // Click trigger to show tooltip
    await trigger.click();

    // Verify tooltip is added to the DOM and has correct properties
    const tooltip = page.locator(tooltipSelector);
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveAttribute('role', 'status');
    await expect(tooltip).toContainText('this site only works on my tailnet');
    await expect(tooltip).toHaveAttribute('data-visible', '');

    // Press Escape to dismiss tooltip
    await page.keyboard.press('Escape');
    await expect(page.locator(tooltipSelector)).toHaveCount(0);

    // Click trigger again to show tooltip
    await trigger.click();
    await expect(page.locator(tooltipSelector)).toBeVisible();

    // Click elsewhere (e.g., page body) to dismiss tooltip
    await page.locator('body').click({ position: { x: 0, y: 0 } });
    await expect(page.locator(tooltipSelector)).toHaveCount(0);
  });
});
