#!/usr/bin/env node

// Lighthouse against the live site, configured by tests/lighthouse.json. Exists
// because @lhci/cli pins an older Lighthouse than PageSpeed Insights uses, which
// shows up as phantom deductions.
//
//   node bin/lighthouse-check.ts

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { readJson } from '../src/lib/json.ts';
import { fromCheckoutCache, siteRoot as root } from '../src/lib/site-root.ts';
import { cli, exitWith } from './lib/args.ts';
import { spawnResult } from './lib/run.ts';
import { annotate, appendSummary, status, table } from './lib/step-summary.ts';

interface LighthouseConfig {
  urls: string[];
  preset: string;
  chromeFlags: string;
  thresholds: Record<string, { level: 'error' | 'warn'; minScore: number }>;
}
type Score = number | null;

const COLUMNS = ['performance', 'accessibility', 'best-practices', 'seo'];

// The first line of a failed run's log that reads as the reason, for its table row.
function firstFailureLine(log: string): string {
  const lines = log
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.find((line) => /^(error|failed|fail|✖|✗|-\s)/i.test(line)) ?? lines.at(-1) ?? 'failed';
}

const slug = (url: string): string => new URL(url).pathname.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'home';
const percent = (score: Score | undefined): number | '-' => (score === null || score === undefined ? '-' : Math.round(score * 100));

export async function main(): Promise<number> {
  cli({ usage: 'usage: node bin/lighthouse-check.ts\n\nRuns Lighthouse against the URLs in tests/lighthouse.json.' });

  const chromePath = process.env.CHROME_PATH || chromium.executablePath();
  if (!fs.existsSync(chromePath)) {
    console.error('Lighthouse browser missing. Run `mise exec -- playwright install chromium` or set CHROME_PATH.');
    return 1;
  }

  const { urls, preset, chromeFlags, thresholds: byCategory } = readJson<LighthouseConfig>(path.join(root, 'tests/lighthouse.json'));
  const outDir = fromCheckoutCache('lighthouse');
  const assertions = Object.entries(byCategory).map(([category, threshold]) => ({ category, ...threshold }));

  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');

  const rows: (string | number)[][] = [];
  let errors = 0;
  let auditFailures = 0;
  let warnings = 0;
  let version = '';

  for (const url of urls) {
    const base = path.join(outDir, `${slug(url)}-${stamp}`);
    // `lighthouse` resolves from node_modules/.bin, which mise puts on PATH.
    const result = spawnResult(
      'lighthouse',
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
    const scores: Record<string, Score> = Object.fromEntries(COLUMNS.map((name) => [name, report.categories[name]?.score ?? null]));

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

    const line = COLUMNS.map((name) => percent(scores[name])).join(' / ');
    rows.push([url, ...COLUMNS.map((name) => percent(scores[name])), level, problems.join('; ') || 'within every threshold']);
    status(slug(url), `${line}${problems.length ? ` (${problems.join('; ')})` : ''}`);
  }

  const thresholds = assertions
    .map((assertion) => `${assertion.category} ${assertion.level === 'error' ? 'fails' : 'warns'} below ${percent(assertion.minScore)}`)
    .join(', ');

  appendSummary(
    [
      `## Lighthouse${version ? ` ${version}` : ''}`,
      '',
      errors === 0 && auditFailures === 0
        ? `${urls.length} page(s) within every failing threshold${warnings ? `, ${warnings} warning(s)` : ''}. ${thresholds}.`
        : `${auditFailures} audit execution failure(s), ${errors} failing threshold(s) across ${urls.length} page(s). ${thresholds}.`,
      '',
      table(['Page', 'Performance', 'Accessibility', 'Best practices', 'SEO', 'Result', 'Detail'], rows),
    ].join('\n'),
  );

  if (errors > 0 || auditFailures > 0) {
    console.error(`\nfailed: ${auditFailures} Lighthouse audit execution failure(s), ${errors} threshold(s)`);
    return 1;
  }

  console.log(`\nok lighthouse ${version}: ${urls.length} page(s) within every failing threshold${warnings ? `; ${warnings} warning(s)` : ''}`);
  return 0;
}

if (import.meta.main) await exitWith('lighthouse-check', main);
