// Every image the build ships, committed or encoded from content, stays under one size limit.
import fs from 'node:fs';
import path from 'node:path';
import { builtPages, finish } from './lib.ts';

const LIMIT_BYTES = 1.5 * 1024 * 1024;

const { distDir } = builtPages('check-assets');

const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const images = fs.readdirSync(distDir, { recursive: true, encoding: 'utf8' })
  .filter((relative) => /\.(?:png|jpe?g|webp|avif|gif|svg)$/i.test(relative))
  .map((relative) => ({ relative, bytes: fs.statSync(path.join(distDir, relative)).size }))
  .toSorted((a, b) => b.bytes - a.bytes);

const total = images.reduce((sum, image) => sum + image.bytes, 0);

finish(
  images.filter(({ bytes }) => bytes >= LIMIT_BYTES).map(({ relative, bytes }) => `${mb(bytes)}  ${relative}`),
  `${images.length} images, ${mb(total)} in all, each under ${mb(LIMIT_BYTES)}`,
  {
    heading: `check-assets: images at or over ${mb(LIMIT_BYTES)}:`,
    fix: `fix: shrink each image below ${mb(LIMIT_BYTES)}: the committed file under public/assets/, or the content original it was encoded from`,
  },
);
