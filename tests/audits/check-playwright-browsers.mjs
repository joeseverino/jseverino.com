#!/usr/bin/env node
import fs from 'node:fs';
import { chromium, firefox, webkit } from 'playwright';

const missing = [chromium, firefox, webkit]
  .map((browserType) => browserType.executablePath())
  .filter((executable) => !fs.existsSync(executable));

if (missing.length > 0) {
  console.error('Playwright browser binaries do not match the installed package:');
  for (const executable of missing) console.error(`  missing ${executable}`);
  console.error('\nRun: npx playwright install chromium firefox webkit');
  process.exit(1);
}

console.log('ok Playwright Chromium, Firefox, and WebKit revisions are installed');
