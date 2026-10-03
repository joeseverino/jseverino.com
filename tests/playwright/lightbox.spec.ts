import { test, expect, type Page } from '@playwright/test';
import { imageHeavyWriteup } from './helpers/writeups.ts';

const WRITEUP = imageHeavyWriteup();

// The writeup's first zoomable figure and the lightbox it opens.
async function openFigurePage(page: Page) {
  await page.goto(WRITEUP);
  return { trigger: page.locator('.prose .image-zoom').first(), dialog: page.locator('dialog.lightbox') };
}

async function openWithPointer(page: Page) {
  const figure = await openFigurePage(page);
  await figure.trigger.click();
  await expect(figure.dialog).toBeVisible();
  return figure;
}

const closeButton = (page: Page) => page.getByRole('button', { name: 'Close' });

async function openWithKeyboard(page: Page) {
  const figure = await openFigurePage(page);
  await figure.trigger.focus();
  await page.keyboard.press('Enter');
  return figure;
}

test.describe('figure lightbox', () => {
  test('clicking a body figure opens the modal and locks scroll', async ({ page }) => {
    const { trigger, dialog } = await openFigurePage(page);
    await expect(trigger).toHaveAttribute('type', 'button');
    await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');

    await trigger.click();

    await expect(dialog).toBeVisible();
    await expect(page.locator('.lightbox-img')).toHaveAttribute('src', /.+/);
    await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
  });

  test('pointer open and close do not leave visible focus outlines', async ({ page }) => {
    const { trigger, dialog } = await openWithPointer(page);
    await expect(dialog).toBeFocused();
    await expect(closeButton(page)).not.toBeFocused();

    await closeButton(page).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
    await expect(trigger).not.toBeFocused();
  });

  test('keyboard close returns focus to the trigger', async ({ page }) => {
    const { trigger, dialog } = await openWithKeyboard(page);
    await expect(dialog).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('closes via the close button and the backdrop', async ({ page }) => {
    const { trigger, dialog } = await openWithPointer(page);
    await closeButton(page).click();
    await expect(dialog).toBeHidden();

    await trigger.click();
    await expect(dialog).toBeVisible();
    // A click anywhere in the overlay outside the caption dismisses it.
    await page.mouse.click(5, 5);
    await expect(dialog).toBeHidden();
  });

  test('opens via the keyboard on a focused figure', async ({ page }) => {
    const { dialog } = await openWithKeyboard(page);
    await expect(dialog).toBeVisible();
  });

  test('copies rich captions as DOM nodes without an HTML parsing sink', async ({ page }) => {
    await page.goto(WRITEUP);
    const trigger = page.locator('.prose figure:has(figcaption) .image-zoom').first();
    await trigger.evaluate((element) => {
      const caption = element.closest('figure')!.querySelector('figcaption')!;
      const emphasis = document.createElement('em');
      emphasis.textContent = 'Rich caption';
      const link = document.createElement('a');
      link.href = '/portfolio/';
      link.textContent = 'Portfolio';
      caption.replaceChildren(emphasis, ' — ', link);
    });
    await trigger.click();
    const caption = page.locator('.lightbox-caption');
    await expect(caption.locator('em')).toHaveText('Rich caption');
    await expect(caption.locator('a')).toHaveAttribute('href', '/portfolio/');
  });
});
