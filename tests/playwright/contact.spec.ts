import { expect, type Locator, type Page, test, withoutTurnstile } from './helpers/test.ts';

const TOKEN = 'test-turnstile-token';

const field = (page: Page, label: 'Name' | 'Email' | 'Message') => page.getByLabel(label, { exact: true });

async function fillContact(page: Page, name: string, email: string, message: string): Promise<void> {
  await field(page, 'Name').fill(name);
  await field(page, 'Email').fill(email);
  await field(page, 'Message').fill(message);
}

// Turnstile hands its token to the form as a hidden cf-turnstile-response field. Its script
// is blocked here, so the test writes that field the way the widget does.
async function solveTurnstile(page: Page): Promise<void> {
  await field(page, 'Name').evaluate((input: HTMLInputElement, value) => {
    const token = Object.assign(document.createElement('input'), { type: 'hidden', name: 'cf-turnstile-response', value });
    input.form?.append(token);
  }, TOKEN);
}

async function submitExpecting(page: Page, kind: 'error' | 'success', text: string): Promise<Locator> {
  await page.getByRole('button', { name: 'Send Message' }).click();
  const status = page.getByRole('status');
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
    const pending = Promise.withResolvers<void>();
    await page.route('/api/contact', async (route) => {
      requests++;
      await pending.promise;
      await route.abort();
    });
    await fillContact(page, 'Jane Doe', 'jane@example.com', 'Keep this message for retry.');
    await solveTurnstile(page);
    try {
      await page.getByRole('button', { name: 'Send Message' }).click();
      await expect.poll(() => requests).toBe(1);
      const sending = page.getByRole('button', { name: 'Sending…' });
      await expect(sending).toBeDisabled();
      // A disabled button takes no click, so the second submit comes from the form itself.
      await sending.evaluate((button: HTMLButtonElement) => {
        if (!button.form) throw new Error('the submit button is outside a form');
        button.form.requestSubmit();
      });
      await expect(page.locator('form')).toHaveAttribute('aria-busy', 'true');
    } finally {
      pending.resolve();
    }
    await expect(page.getByRole('status')).toContainText('Could not reach the server');
    await expect(page.getByRole('button', { name: 'Send Message' })).toBeEnabled();
    await expect(field(page, 'Message')).toHaveValue('Keep this message for retry.');
    expect(requests).toBe(1);
  });

  test('an empty form is held by the browser: each required field is missing and nothing is sent', async ({ page }) => {
    let sent = false;
    await page.route('/api/contact', (route) => {
      sent = true;
      return route.abort();
    });
    await page.getByRole('button', { name: 'Send Message' }).click();
    for (const label of ['Name', 'Email', 'Message'] as const) {
      expect(await field(page, label).evaluate((element: HTMLInputElement) => element.validity.valueMissing), label).toBe(true);
    }
    await expect(field(page, 'Name')).toBeFocused();
    expect(sent).toBe(false);
  });

  test('without a Turnstile token the form asks for the challenge, and typing clears the notice', async ({ page }) => {
    await fillContact(page, 'John Doe', 'john@example.com', 'Hello! This is a test message.');

    const status = await submitExpecting(page, 'error', 'Please complete the verification challenge');

    await field(page, 'Name').press('KeyA');
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
    await solveTurnstile(page);

    const request = page.waitForRequest('/api/contact');
    await submitExpecting(page, 'success', 'Thanks, your message has been sent');
    const submitted = await request;
    expect(submitted.method()).toBe('POST');
    expect(submitted.postDataJSON()).toEqual({
      name: 'Jane Doe',
      email: 'jane@example.com',
      message: 'Mocked message content',
      company: '',
      sourceUrl: expect.stringMatching(/\/contact\/$/),
      turnstileToken: TOKEN,
    });

    for (const label of ['Name', 'Email', 'Message'] as const) await expect(field(page, label)).toHaveValue('');
  });
});
