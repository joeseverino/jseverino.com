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

interface Assertion {
  category: string;
  level: 'error' | 'warn';
  minScore: number;
}

// How each page is audited: the Lighthouse settings, the browser, and where its reports go.
interface AuditSetup {
  preset: string;
  chromeFlags: string;
  chromePath: string;
  outDir: string;
  stamp: string;
}

// A threshold a page's scores fall below, worded for its row.
interface Miss {
  level: Assertion['level'];
  text: string;
}

// One page's table row and missed thresholds; a page whose run failed has no version.
interface PageResult {
  row: (string | number)[];
  misses: Miss[];
  version?: string;
}

// One Lighthouse run, its reports written beside its log; the log's text, and the report
// when the run produced one.
function audit(url: string, { preset, chromeFlags, chromePath, outDir, stamp }: AuditSetup): { log: string; reportFile?: string } {
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
  const reportFile = `${base}.report.json`;
  return result.code === 0 && fs.existsSync(reportFile) ? { log, reportFile } : { log };
}

const missed = (scores: Record<string, Score>, assertions: readonly Assertion[]): Miss[] =>
  assertions.flatMap(({ category, level, minScore }) => {
    const score = scores[category] ?? 0;
    return score < minScore ? [{ level, text: `${category} ${percent(score)} below ${percent(minScore)}` }] : [];
  });

// Audits one page and reports it to the log and the annotations.
function auditPage(url: string, setup: AuditSetup, assertions: readonly Assertion[]): PageResult {
  const { log, reportFile } = audit(url, setup);
  if (!reportFile) {
    const reason = firstFailureLine(log);
    status(slug(url), `FAILED: ${reason}`);
    annotate('error', 'lighthouse', `${url}: ${reason}`);
    return { row: [url, '-', '-', '-', '-', '**FAIL**', reason], misses: [] };
  }

  const report = readJson<{
    lighthouseVersion: string;
    categories: Record<string, { score: Score } | undefined>;
  }>(reportFile);
  const scores: Record<string, Score> = Object.fromEntries(COLUMNS.map((name) => [name, report.categories[name]?.score ?? null]));
  const misses = missed(scores, assertions);
  for (const { level, text } of misses) annotate(level === 'error' ? 'error' : 'warning', 'lighthouse', `${url}: ${text}`);
  let result = 'pass';
  if (misses.some(({ level }) => level === 'error')) result = '**FAIL**';
  else if (misses.length > 0) result = 'warn';

  const percents = COLUMNS.map((name) => percent(scores[name]));
  const problems = misses.map(({ text }) => text).join('; ');
  status(slug(url), `${percents.join(' / ')}${problems ? ` (${problems})` : ''}`);
  return { row: [url, ...percents, result, problems || 'within every threshold'], misses, version: report.lighthouseVersion };
}

export async function main(): Promise<number> {
  cli({ usage: 'usage: node bin/lighthouse-check.ts\n\nRuns Lighthouse against the URLs in tests/lighthouse.json.' });

  const chromePath = process.env.CHROME_PATH || chromium.executablePath();
  if (!fs.existsSync(chromePath)) {
    console.error('Lighthouse browser missing. Run `mise exec -- playwright install chromium` or set CHROME_PATH.');
    return 1;
  }

  const { urls, preset, chromeFlags, thresholds: byCategory } = readJson<LighthouseConfig>(path.join(root, 'tests/lighthouse.json'));
  const outDir = fromCheckoutCache('lighthouse');
  const assertions: Assertion[] = Object.entries(byCategory).map(([category, threshold]) => ({ category, ...threshold }));

  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');

  const pages = urls.map((url) => auditPage(url, { preset, chromeFlags, chromePath, outDir, stamp }, assertions));
  const misses = pages.flatMap((page) => page.misses);
  const errors = misses.filter(({ level }) => level === 'error').length;
  const warnings = misses.length - errors;
  const auditFailures = pages.filter((page) => page.version === undefined).length;
  const version = pages.findLast((page) => page.version)?.version ?? '';
  const rows = pages.map(({ row }) => row);

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
