import { test, expect } from '@playwright/test';
import { imageHeavyWriteup } from './helpers/writeups';

const WRITEUP = imageHeavyWriteup();

test.describe('figure lightbox', () => {
  test('clicking a body figure opens the modal and locks scroll', async ({ page }) => {
    await page.goto(WRITEUP);
    const img = page.locator('.prose img.zoomable').first();
    await expect(img).toHaveAttribute('role', 'button');

    await img.click();

    const dialog = page.locator('dialog.lightbox');
    await expect(dialog).toBeVisible();
    await expect(page.locator('.lightbox-img')).toHaveAttribute('src', /.+/);
    await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
  });

  test('pointer close does not leave a visible focus outline', async ({ page }) => {
    await page.goto(WRITEUP);
    const img = page.locator('.prose img.zoomable').first();
    await img.click();

    const dialog = page.locator('dialog.lightbox');
    await expect(dialog).toBeVisible();

    await page.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
    await expect(img).toBeFocused();
    await expect(img).toHaveCSS('outline-style', 'none');
  });

  test('keyboard close returns focus to the trigger', async ({ page }) => {
    await page.goto(WRITEUP);
    const img = page.locator('.prose img.zoomable').first();
    await img.focus();
    await page.keyboard.press('Enter');

    const dialog = page.locator('dialog.lightbox');
    await expect(dialog).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(img).toBeFocused();
  });

  test('closes via the close button and the backdrop', async ({ page }) => {
    await page.goto(WRITEUP);
    const img = page.locator('.prose img.zoomable').first();
    const dialog = page.locator('dialog.lightbox');

    await img.click();
    await expect(dialog).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();

    await img.click();
    await expect(dialog).toBeVisible();
    // A click anywhere in the overlay outside the caption dismisses it.
    await page.mouse.click(5, 5);
    await expect(dialog).toBeHidden();
  });

  test('opens via the keyboard on a focused figure', async ({ page }) => {
    await page.goto(WRITEUP);
    const img = page.locator('.prose img.zoomable').first();
    await img.focus();
    await page.keyboard.press('Enter');

    await expect(page.locator('dialog.lightbox')).toBeVisible();
  });
});
