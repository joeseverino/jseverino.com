import { test, expect } from '@playwright/test';
import { privateLinkWriteup } from './writeups.ts';

test.describe('Private Tooltip Interactive Verification', () => {
  test('renders, positions, and dismisses tooltips correctly', async ({ page }) => {
    await page.goto(privateLinkWriteup());
    await page.waitForLoadState('networkidle');

    const trigger = page.locator('[data-private-tooltip]').first();
    await expect(trigger).toBeVisible();

    const tooltipSelector = '.private-tooltip';
    await expect(page.locator(tooltipSelector)).toHaveCount(0);

    await trigger.click();

    const tooltip = page.locator(tooltipSelector);
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveAttribute('role', 'status');
    await expect(tooltip).not.toBeEmpty();
    await expect(tooltip).toHaveAttribute('data-visible', '');

    await page.keyboard.press('Escape');
    await expect(page.locator(tooltipSelector)).toHaveCount(0);

    await trigger.click();
    await expect(page.locator(tooltipSelector)).toBeVisible();

    await page.locator('body').click({ position: { x: 0, y: 0 } });
    await expect(page.locator(tooltipSelector)).toHaveCount(0);
  });
});
