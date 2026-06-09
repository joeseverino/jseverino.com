import { test, expect } from '@playwright/test';

test.describe('Contact Form Interactive Verification', () => {
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

    // Initially, fields should be empty and form validation should block submission
    await expect(nameInput).toHaveValue('');
    await expect(emailInput).toHaveValue('');
    await expect(messageInput).toHaveValue('');

    // Trigger validation by clicking submit on empty form
    await submitButton.click();

    // Assert that the browser validation blocks submission (field invalid)
    const isNameInvalid = await nameInput.evaluate((el: HTMLInputElement) => !el.checkValidity());
    expect(isNameInvalid).toBe(true);
  });

  test('shows turnstile error message if challenge is not completed', async ({ page }) => {
    // Fill the inputs
    await page.locator('#contact-name').fill('John Doe');
    await page.locator('#contact-email').fill('john@example.com');
    await page.locator('#contact-message').fill('Hello! This is a test message.');

    // Attempt to submit without solving turnstile
    await page.locator('.contact-submit').click();

    // Verify error message is shown
    const status = page.locator('.contact-status');
    await expect(status).toBeVisible();
    await expect(status).toHaveAttribute('data-kind', 'error');
    await expect(status).toContainText('Please complete the verification challenge');

    // Typing should hide the error message
    await page.locator('#contact-name').press('KeyA');
    await expect(status).toBeHidden();
  });

  test('submits successfully with simulated turnstile and mocked api', async ({ page }) => {
    // Mock the POST request to /api/contact
    await page.route('/api/contact', async (route) => {
      expect(route.request().method()).toBe('POST');
      const payload = route.request().postDataJSON();
      expect(payload.name).toBe('Jane Doe');
      expect(payload.email).toBe('jane@example.com');
      expect(payload.message).toBe('Mocked message content');
      expect(payload.turnstileToken).toBe('mocked-turnstile-token');

      // Return a simulated success response
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    // Fill form fields
    await page.locator('#contact-name').fill('Jane Doe');
    await page.locator('#contact-email').fill('jane@example.com');
    await page.locator('#contact-message').fill('Mocked message content');

    // Simulate Cloudflare Turnstile injecting a token response into the form.
    // We mock FormData.prototype.get to ensure our token is read even if the Turnstile iframe renders empty inputs.
    await page.evaluate(() => {
      const originalGet = FormData.prototype.get;
      FormData.prototype.get = function (name) {
        if (name === 'cf-turnstile-response') return 'mocked-turnstile-token';
        return originalGet.call(this, name);
      };
    });

    // Submit the form
    await page.locator('.contact-submit').click();

    // Verify success state and form reset
    const status = page.locator('.contact-status');
    await expect(status).toBeVisible();
    await expect(status).toHaveAttribute('data-kind', 'success');
    await expect(status).toContainText('Thanks, your message has been sent');

    // Form inputs should be cleared/reset
    await expect(page.locator('#contact-name')).toHaveValue('');
    await expect(page.locator('#contact-email')).toHaveValue('');
    await expect(page.locator('#contact-message')).toHaveValue('');
  });
});
