import { expect, type Page, test } from './helpers/test.ts';

async function menu(page: Page) {
  await page.goto('/');
  // The closed popover is out of the accessibility tree, so its lookup reaches past it.
  return { toggle: page.getByRole('button', { name: 'Menu' }), popover: page.getByRole('navigation', { name: 'Mobile', includeHidden: true }) };
}

// The middle bar fades as the bars cross, so its opacity is what the toggle draws.
const expectToggleShowsOpen = (page: Page, open: boolean) =>
  expect(page.getByRole('button', { name: 'Menu' }).locator('.nav-toggle-bar').nth(1)).toHaveCSS('opacity', open ? '0' : '1');

async function openMenu(page: Page) {
  const nav = await menu(page);
  await nav.toggle.click();
  await expect(nav.popover).toBeVisible();
  return nav;
}

// The highlight is each component's own style, so the test finds each by its class.
test('the brand link and the card links draw no tap highlight', async ({ page, browserName }) => {
  test.skip(browserName === 'firefox', 'Firefox does not implement -webkit-tap-highlight-color.');

  await page.goto('/portfolio/');

  const brand = page.locator('.brand');
  const cardLinks = page.locator('.project-card a');

  await expect(brand).toHaveCSS('-webkit-tap-highlight-color', 'rgba(0, 0, 0, 0)');
  await expect(cardLinks.first()).toHaveCSS('-webkit-tap-highlight-color', 'rgba(0, 0, 0, 0)');
});

test('mobile menu opens via hamburger and closes on Escape', async ({ page }) => {
  const { toggle, popover } = await menu(page);

  await expect(toggle).toBeVisible();
  await expect(popover).toBeHidden();

  await toggle.click();
  await expect(popover).toBeVisible();
  await expectToggleShowsOpen(page, true);
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');

  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();
  await expectToggleShowsOpen(page, false);
  await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
});

test('mobile menu closes when the backdrop is clicked', async ({ page }) => {
  const { popover } = await openMenu(page);

  // Click the popover's own backdrop (top-left corner), not a nav link.
  await popover.click({ position: { x: 4, y: 4 } });
  await expect(popover).toBeHidden();
  await expectToggleShowsOpen(page, false);
});

test('mobile menu closes after navigating via a menu link', async ({ page }) => {
  const { popover } = await openMenu(page);

  await popover
    .getByRole('link', { name: /portfolio/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/portfolio\/$/);
  await expect(popover).toBeHidden();
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the menu opens natively and staggers its items in', async ({ page }) => {
    const { toggle, popover } = await menu(page);
    await toggle.click();
    await expect(popover).toBeVisible();
    const delays = await popover.locator('.mobile-nav-list li').evaluateAll((items) => items.map((item) => getComputedStyle(item).transitionDelay));
    expect(new Set(delays).size).toBe(delays.length);
  });
});
