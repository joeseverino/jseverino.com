// Generates the 1200x630 Open Graph social card at public/assets/og/og-default.png.
// Run with: node bin/make-og-image.mjs
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const portraitPath = path.join(root, 'public/assets/pages/home/images/portrait.jpg');
const outDir = path.join(root, 'public/assets/og');
const outPath = path.join(outDir, 'og-default.png');

const W = 1200;
const H = 630;
const PHOTO_W = 462;
const TEXT_W = W - PHOTO_W;
const PAD = 72;

const escapeXml = (value) =>
  value.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

const fontStack = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const name = 'Joe Severino';
const eyebrow = 'CYBERSECURITY • NETWORKING';
const tagline = 'Hands-on security & infrastructure projects';
const certs = 'CCNA • Security+ • ISC2 CC';
const domain = 'jseverino.com';

const panel = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#381d92"/>
      <stop offset="1" stop-color="#1c0a63"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <text x="${PAD}" y="238" font-family="${fontStack}" font-size="24" font-weight="600"
        letter-spacing="3.5" fill="#b9a7e8">${escapeXml(eyebrow)}</text>
  <text x="${PAD}" y="324" font-family="${fontStack}" font-size="78" font-weight="700"
        letter-spacing="-1.5" fill="#ffffff">${escapeXml(name)}</text>
  <rect x="${PAD}" y="362" width="64" height="5" rx="2.5" fill="#7c5cd6"/>
  <text x="${PAD}" y="424" font-family="${fontStack}" font-size="30" font-weight="400"
        fill="#e7e0fb">${escapeXml(tagline)}</text>
  <text x="${PAD}" y="470" font-family="${fontStack}" font-size="24" font-weight="600"
        letter-spacing="0.5" fill="#b9a7e8">${escapeXml(certs)}</text>
  <text x="${PAD}" y="558" font-family="${fontStack}" font-size="25" font-weight="600"
        letter-spacing="0.5" fill="#b9a7e8">${escapeXml(domain)}</text>
</svg>`;

const photo = await sharp(portraitPath)
  .resize(PHOTO_W, H, { fit: 'cover', position: 'top' })
  .toBuffer();

// Soft seam between the photo and the panel.
const seam = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect x="${TEXT_W - 1}" y="0" width="2" height="${H}" fill="#1c0a63" opacity="0.6"/>
</svg>`;

fs.mkdirSync(outDir, { recursive: true });
await sharp(Buffer.from(panel))
  .composite([
    { input: photo, left: TEXT_W, top: 0 },
    { input: Buffer.from(seam), left: 0, top: 0 },
  ])
  .png()
  .toFile(outPath);

console.log(`Wrote ${path.relative(root, outPath)} (${W}x${H})`);
