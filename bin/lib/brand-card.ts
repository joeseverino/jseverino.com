// Every brand card carries the home portrait in the brand card colors; the caller gives its size, wording and target.
import { launchBrowser, renderCard, type CardOptions } from 'branding-engine';
import { brandCardColors } from '../../src/lib/brand.ts';
import { fromRoot } from '../../src/lib/site-root.ts';

export async function renderBrandCard(card: Omit<CardOptions, 'colors' | 'photoPath'>): Promise<void> {
  const browser = await launchBrowser();
  try {
    await renderCard(browser, {
      ...card,
      colors: brandCardColors(),
      photoPath: fromRoot('src/content/pages/home/images/portrait.jpg'),
    });
  } finally {
    await browser.close();
  }
}
