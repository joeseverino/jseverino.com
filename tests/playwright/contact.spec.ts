import { test, expect, type Locator, type Page } from '@playwright/test';

async function fillContact(page: Page, name: string, email: string, message: string): Promise<void> {
  await page.locator('#contact-name').fill(name);
  await page.locator('#contact-email').fill(email);
  await page.locator('#contact-message').fill(message);
}

// Submits the form and waits for the status line to report kind and text.
async function submitExpecting(page: Page, kind: 'error' | 'success', text: string): Promise<Locator> {
  await page.locator('.contact-submit').click();
  const status = page.locator('.contact-status');
  await expect(status).toBeVisible();
  await expect(status).toHaveAttribute('data-kind', kind);
  await expect(status).toContainText(text);
  return status;
}

test.describe('Contact Form Interactive Verification', () => {
  test('pending submissions are single-flight and network failure preserves the message', async ({ page }) => {
    let requests = 0;
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
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
  test.beforeEach(async ({ page }) => {
    // Block the Turnstile script so its always-pass test key cannot auto-solve
    // mid-test. Each test then controls the token state deterministically instead
    // of racing the widget.
    await page.route('**/challenges.cloudflare.com/**', (route) => route.abort());
    await page.goto('/contact/');
  });

  test('validates required fields and shows HTML5 constraints', async ({ page }) => {
    const submitButton = page.locator('.contact-submit');
    const nameInput = page.locator('#contact-name');
    const emailInput = page.locator('#contact-email');
    const messageInput = page.locator('#contact-message');

    await expect(nameInput).toHaveValue('');
    await expect(emailInput).toHaveValue('');
    await expect(messageInput).toHaveValue('');

    await submitButton.click();

    const isNameInvalid = await nameInput.evaluate((el: HTMLInputElement) => !el.checkValidity());
    expect(isNameInvalid).toBe(true);
  });

  test('shows turnstile error message if challenge is not completed', async ({ page }) => {
    await fillContact(page, 'John Doe', 'john@example.com', 'Hello! This is a test message.');

    // Submitting without solving turnstile shows the error.
    const status = await submitExpecting(page, 'error', 'Please complete the verification challenge');

    await page.locator('#contact-name').press('KeyA');
    await expect(status).toBeHidden();
  });

  test('submits successfully with simulated turnstile and mocked api', async ({ page }) => {
    await page.route('/api/contact', async (route) => {
      expect(route.request().method()).toBe('POST');
      const payload = route.request().postDataJSON();
      expect(payload.name).toBe('Jane Doe');
      expect(payload.email).toBe('jane@example.com');
      expect(payload.message).toBe('Mocked message content');
      expect(payload.turnstileToken).toBe('mocked-turnstile-token');

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

    await submitExpecting(page, 'success', 'Thanks, your message has been sent');

    await expect(page.locator('#contact-name')).toHaveValue('');
    await expect(page.locator('#contact-email')).toHaveValue('');
    await expect(page.locator('#contact-message')).toHaveValue('');
  });
});
