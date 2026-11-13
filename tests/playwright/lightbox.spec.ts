import { expect, type Page, test } from './helpers/test.ts';
import { imageHeavyWriteup } from './helpers/writeups.ts';

const WRITEUP = imageHeavyWriteup();

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
  test('clicking a figure opens the dialog with page scroll locked and focus on the dialog, not its close button', async ({ page }) => {
    const { trigger, dialog } = await openFigurePage(page);
    await expect(trigger).toHaveAttribute('type', 'button');
    await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');

    await trigger.click();

    await expect(dialog).toBeVisible();
    await expect(page.locator('.lightbox-img')).toHaveAttribute('src', /.+/);
    await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
    await expect(dialog).toBeFocused();
    await expect(closeButton(page)).not.toBeFocused();
  });

  // A pointer close leaves focus off the trigger, so no focus ring appears on the figure.
  test('the close button and the backdrop each close it and unlock scroll, without focusing the trigger', async ({ page }) => {
    const { trigger, dialog } = await openWithPointer(page);
    await closeButton(page).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
    await expect(trigger).not.toBeFocused();

    await trigger.click();
    await expect(dialog).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(dialog).toBeHidden();
    await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
  });

  test('keyboard close returns focus to the trigger', async ({ page }) => {
    const { trigger, dialog } = await openWithKeyboard(page);
    await expect(dialog).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});
