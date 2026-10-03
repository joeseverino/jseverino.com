#!/usr/bin/env node
// Lighthouse against the live site. URLs, the device preset, Chrome flags, and
// the score thresholds all come from tests/lighthouserc.json, so the config has one
// home; this runner exists because @lhci/cli pins an older Lighthouse than the
// one PageSpeed Insights scores with, and the gap shows up as phantom
// deductions. Reports land in the config's outputDir; the per-page scores go
// to the job summary in CI.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { firstFailureLine } from './lib/audit-summary.ts';
import { spawnResult, status } from './lib/run.ts';
import { annotate, appendSummary, table } from './lib/step-summary.ts';
import { siteRoot as root } from '../src/lib/site-root.ts';
import { readJson } from '../src/lib/json.ts';

const chromePath = process.env.CHROME_PATH || chromium.executablePath();
if (!fs.existsSync(chromePath)) {
  console.error('Lighthouse browser missing. Run `npx playwright install chromium` or set CHROME_PATH.');
  process.exit(1);
}
// tests/lighthouserc.json: the fields this runner honors.
interface LighthouseConfig {
  collect: { url: string[]; settings?: { preset?: string; chromeFlags?: string } };
  upload?: { outputDir?: string };
  assert: { assertions: Record<string, [level: string, options: { minScore: number }]> };
}
type Score = number | null;

const config = readJson<{ ci: LighthouseConfig }>(path.join(root, 'tests/lighthouserc.json')).ci;

const urls = config.collect.url;
const preset = config.collect.settings?.preset ?? 'desktop';
const chromeFlags = config.collect.settings?.chromeFlags ?? '--headless';
const outDir = path.join(root, config.upload?.outputDir ?? 'lighthouse-reports');
const assertions = Object.entries(config.assert.assertions).map(([key, [level, { minScore }]]) => ({
  category: key.replace(/^categories:/, ''),
  level,
  minScore,
}));
const columns = ['performance', 'accessibility', 'best-practices', 'seo'];

fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');
const slug = (url: string): string => new URL(url).pathname.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'home';
const percent = (score: Score | undefined): number | '-' => (score === null || score === undefined ? '-' : Math.round(score * 100));

const rows: (string | number)[][] = [];
let errors = 0;
let auditFailures = 0;
let warnings = 0;
let version = '';

for (const url of urls) {
  const base = path.join(outDir, `${slug(url)}-${stamp}`);
  const result = spawnResult(
    path.join(root, 'node_modules/.bin/lighthouse'),
    [
      url,
      '--output=json',
      '--output=html',
      `--output-path=${base}`,
      `--preset=${preset}`,
      `--chrome-flags=${chromeFlags}`,
      '--quiet',
      '--no-enable-error-reporting',
    ],
    { cwd: root, env: { CHROME_PATH: chromePath }, timeout: 180_000 },
  );

  const log = [result.error?.message, result.stdout, result.stderr].filter(Boolean).join('\n');
  fs.writeFileSync(`${base}.log`, log);

  if (result.code !== 0 || !fs.existsSync(`${base}.report.json`)) {
    const reason = firstFailureLine(log);
    rows.push([url, '-', '-', '-', '-', '**FAIL**', reason]);
    auditFailures += 1;
    status(slug(url), `FAILED: ${reason}`);
    annotate('error', 'lighthouse', `${url}: ${reason}`);
    continue;
  }

  const report = readJson<{
    lighthouseVersion: string;
    categories: Record<string, { score: Score } | undefined>;
  }>(`${base}.report.json`);
  version = report.lighthouseVersion;
  const scores: Record<string, Score> = Object.fromEntries(columns.map((name) => [name, report.categories[name]?.score ?? null]));

  const problems: string[] = [];
  let level = 'pass';
  for (const assertion of assertions) {
    const score = scores[assertion.category] ?? 0;
    if (score >= assertion.minScore) continue;
    problems.push(`${assertion.category} ${percent(score)} below ${percent(assertion.minScore)}`);
    if (assertion.level === 'error') {
      errors += 1;
      level = '**FAIL**';
    } else {
      warnings += 1;
      if (level === 'pass') level = 'warn';
    }
    annotate(assertion.level === 'error' ? 'error' : 'warning', 'lighthouse', `${url}: ${problems.at(-1)}`);
  }

  const line = columns.map((name) => percent(scores[name])).join(' / ');
  rows.push([url, ...columns.map((name) => percent(scores[name])), level, problems.join('; ') || 'within every threshold']);
  status(slug(url), `${line}${problems.length ? ` (${problems.join('; ')})` : ''}`);
}

const thresholds = assertions
  .map((assertion) => `${assertion.category} ${assertion.level === 'error' ? 'fails' : 'warns'} below ${percent(assertion.minScore)}`)
  .join(', ');

appendSummary([
  `## Lighthouse${version ? ` ${version}` : ''}`,
  '',
  errors === 0 && auditFailures === 0
    ? `${urls.length} page(s) within every failing threshold${warnings ? `, ${warnings} warning(s)` : ''}. ${thresholds}.`
    : `${auditFailures} audit execution failure(s), ${errors} failing threshold(s) across ${urls.length} page(s). ${thresholds}.`,
  '',
  table(['Page', 'Performance', 'Accessibility', 'Best practices', 'SEO', 'Result', 'Detail'], rows),
].join('\n'));

if (errors > 0 || auditFailures > 0) {
  console.error(`\nfailed: ${auditFailures} Lighthouse audit execution failure(s), ${errors} threshold(s)`);
  process.exit(1);
}

console.log(`\nok lighthouse ${version}: ${urls.length} page(s) within every failing threshold${warnings ? `; ${warnings} warning(s)` : ''}`);
