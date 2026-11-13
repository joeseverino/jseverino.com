import { expect, type Locator, type Page, test, withoutTurnstile } from './helpers/test.ts';

async function fillContact(page: Page, name: string, email: string, message: string): Promise<void> {
  await page.locator('#contact-name').fill(name);
  await page.locator('#contact-email').fill(email);
  await page.locator('#contact-message').fill(message);
}

async function submitExpecting(page: Page, kind: 'error' | 'success', text: string): Promise<Locator> {
  await page.locator('.contact-submit').click();
  const status = page.locator('.contact-status');
  await expect(status).toBeVisible();
  await expect(status).toHaveAttribute('data-kind', kind);
  await expect(status).toContainText(text);
  return status;
}

test.describe('contact form', () => {
  test.beforeEach(async ({ page }) => {
    await withoutTurnstile(page);
    await page.goto('/contact/');
  });

  test('a submit while one is pending sends nothing, and a network failure keeps the message for a retry', async ({ page }) => {
    let requests = 0;
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    await page.route('/api/contact', async (route) => {
      requests++;
      await pending;
      await route.abort();
    });
    await fillContact(page, 'Jane Doe', 'jane@example.com', 'Keep this message for retry.');
    await page.locator('form').evaluate((form) => {
      const token = document.createElement('input');
      token.type = 'hidden';
      token.name = 'cf-turnstile-response';
      token.value = 'test-token';
      form.append(token);
    });
    try {
      await page.locator('.contact-submit').click();
      await expect.poll(() => requests).toBe(1);
      await page.locator('form').evaluate((form) => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      await expect(page.locator('form')).toHaveAttribute('aria-busy', 'true');
      await expect(page.locator('.contact-submit')).toBeDisabled();
    } finally {
      finish();
    }
    await expect(page.locator('.contact-status')).toContainText('Could not reach the server');
    await expect(page.locator('.contact-submit')).toBeEnabled();
    await expect(page.locator('#contact-message')).toHaveValue('Keep this message for retry.');
    expect(requests).toBe(1);
  });

  test('an empty form is held by the browser: each required field is missing and nothing is sent', async ({ page }) => {
    let sent = false;
    await page.route('/api/contact', (route) => {
      sent = true;
      return route.abort();
    });
    await page.getByRole('button', { name: 'Send Message' }).click();
    for (const label of ['Name', 'Email', 'Message']) {
      const field = page.getByLabel(label, { exact: true });
      expect(await field.evaluate((element: HTMLInputElement) => element.validity.valueMissing), label).toBe(true);
    }
    await expect(page.getByLabel('Name', { exact: true })).toBeFocused();
    expect(sent).toBe(false);
  });

  test('without a Turnstile token the form asks for the challenge, and typing clears the notice', async ({ page }) => {
    await fillContact(page, 'John Doe', 'john@example.com', 'Hello! This is a test message.');

    const status = await submitExpecting(page, 'error', 'Please complete the verification challenge');

    await page.locator('#contact-name').press('KeyA');
    await expect(status).toBeHidden();
  });

  test('a verified submit posts the fields and the token, confirms, and clears the form', async ({ page }) => {
    await page.route('/api/contact', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    await fillContact(page, 'Jane Doe', 'jane@example.com', 'Mocked message content');

    // The Turnstile script is blocked, so stub the token the form reads off
    // FormData on submit.
    await page.evaluate(() => {
      const originalGet = FormData.prototype.get;
      FormData.prototype.get = function (name) {
        if (name === 'cf-turnstile-response') return 'mocked-turnstile-token';
        return originalGet.call(this, name);
      };
    });

    const request = page.waitForRequest('/api/contact');
    await submitExpecting(page, 'success', 'Thanks, your message has been sent');
    const submitted = await request;
    expect(submitted.method()).toBe('POST');
    expect(submitted.postDataJSON()).toMatchObject({
      name: 'Jane Doe',
      email: 'jane@example.com',
      message: 'Mocked message content',
      turnstileToken: 'mocked-turnstile-token',
    });

    await expect(page.locator('#contact-name')).toHaveValue('');
    await expect(page.locator('#contact-email')).toHaveValue('');
    await expect(page.locator('#contact-message')).toHaveValue('');
  });
});
