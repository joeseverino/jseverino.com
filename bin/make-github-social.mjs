// Generates the 1280x640 GitHub repo social preview at .github/social-preview.png.
// Upload via the repo's Settings -> Social preview. Not served from the site.
// Run with: node bin/make-github-social.mjs
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const portraitPath = path.join(root, 'public/assets/pages/home/images/portrait.jpg');
const outDir = path.join(root, '.github');
const outPath = path.join(outDir, 'social-preview.png');

const W = 1280;
const H = 640;
const PHOTO_W = 480;
const TEXT_W = W - PHOTO_W;
const PAD = 80;

const escapeXml = (value) =>
  value.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

const fontStack = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const eyebrow = 'GITHUB • OPEN SOURCE';
const name = 'jseverino.com';
const tagline = 'Source for my personal site';
const stack = 'Astro • TypeScript • Cloudflare Pages';
const repo = 'github.com/joeseverino/jseverino.com';

const panel = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#381d92"/>
      <stop offset="1" stop-color="#1c0a63"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <text x="${PAD}" y="232" font-family="${fontStack}" font-size="24" font-weight="600"
        letter-spacing="3.5" fill="#b9a7e8">${escapeXml(eyebrow)}</text>
  <text x="${PAD}" y="324" font-family="${fontStack}" font-size="82" font-weight="700"
        letter-spacing="-1.5" fill="#ffffff">${escapeXml(name)}</text>
  <rect x="${PAD}" y="362" width="64" height="5" rx="2.5" fill="#7c5cd6"/>
  <text x="${PAD}" y="426" font-family="${fontStack}" font-size="30" font-weight="400"
        fill="#e7e0fb">${escapeXml(tagline)}</text>
  <text x="${PAD}" y="472" font-family="${fontStack}" font-size="24" font-weight="600"
        letter-spacing="0.5" fill="#b9a7e8">${escapeXml(stack)}</text>
  <text x="${PAD}" y="566" font-family="${fontStack}" font-size="25" font-weight="600"
        letter-spacing="0.5" fill="#b9a7e8">${escapeXml(repo)}</text>
</svg>`;

const photo = await sharp(portraitPath)
  .resize(PHOTO_W, H, { fit: 'cover', position: 'top' })
  .toBuffer();

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
