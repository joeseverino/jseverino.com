#!/usr/bin/env node
// Lighthouse against the live site. URLs, the device preset, Chrome flags, and
// the score thresholds all come from .lighthouserc.json, so the config has one
// home; this runner exists because @lhci/cli pins an older Lighthouse than the
// one PageSpeed Insights scores with, and the gap shows up as phantom
// deductions. Reports land in the config's outputDir; the per-page scores go
// to the job summary in CI.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { firstFailureLine } from './lib/audit-summary.mjs';
import { status } from './lib/run.mjs';
import { annotate, appendSummary, table } from './lib/step-summary.mjs';
import { siteRoot } from '../src/lib/site-root.mjs';

const root = siteRoot;
const config = JSON.parse(fs.readFileSync(path.join(root, '.lighthouserc.json'), 'utf8')).ci;

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
const slug = (url) => new URL(url).pathname.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'home';
const percent = (score) => (score === null || score === undefined ? '-' : Math.round(score * 100));

const rows = [];
let errors = 0;
let warnings = 0;
let version = '';

for (const url of urls) {
  const base = path.join(outDir, `${slug(url)}-${stamp}`);
  const result = spawnSync(
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
    { cwd: root, encoding: 'utf8' },
  );

  if (result.status !== 0 || !fs.existsSync(`${base}.report.json`)) {
    const reason = firstFailureLine(`${result.stdout}\n${result.stderr}`);
    rows.push([url, '-', '-', '-', '-', '**FAIL**', reason]);
    errors += 1;
    status(slug(url), `FAILED: ${reason}`);
    annotate('error', 'lighthouse', `${url}: ${reason}`);
    continue;
  }

  const report = JSON.parse(fs.readFileSync(`${base}.report.json`, 'utf8'));
  version = report.lighthouseVersion;
  const scores = Object.fromEntries(columns.map((name) => [name, report.categories[name]?.score ?? null]));

  const problems = [];
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
  errors === 0
    ? `${urls.length} page(s) within every failing threshold${warnings ? `, ${warnings} warning(s)` : ''}. ${thresholds}.`
    : `${errors} failing threshold(s) across ${urls.length} page(s). ${thresholds}.`,
  '',
  table(['Page', 'Performance', 'Accessibility', 'Best practices', 'SEO', 'Result', 'Detail'], rows),
].join('\n'));

if (errors > 0) {
  console.error(`\nfailed: ${errors} Lighthouse threshold(s)`);
  process.exit(1);
}

console.log(`\nok lighthouse ${version}: ${urls.length} page(s) within every failing threshold${warnings ? `; ${warnings} warning(s)` : ''}`);
