// Generates the 1200x630 Open Graph social card at public/assets/og/og-default.png.
// Run with: node bin/make-og-image.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderCard } from './lib/card.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

await renderCard({
  width: 1200,
  height: 630,
  photoWidth: 462,
  eyebrow: 'Cybersecurity • Networking',
  name: 'Joe Severino',
  tagline: 'Hands-on security & infrastructure projects',
  meta: 'CCNA • Security+ • ISC2 CC',
  url: 'jseverino.com',
  photoPath: path.join(root, 'public/assets/pages/home/images/portrait.jpg'),
  outPath: path.join(root, 'public/assets/og/og-default.png'),
});

console.log('Wrote public/assets/og/og-default.png (1200x630)');
