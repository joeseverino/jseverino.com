// Lighthouse against the live site, configured by tests/lighthouse.json. Exists
// because @lhci/cli pins an older Lighthouse than PageSpeed Insights uses, which
// shows up as phantom deductions.

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { readJson } from '../src/lib/json.ts';
import { fromCheckoutCache, siteRoot as root } from '../src/lib/site-root.ts';
import { cli, exitWith } from './lib/args.ts';
import { spawnResult } from './lib/run.ts';
import { annotate, appendSummary, status, table } from './lib/step-summary.ts';

// Lighthouse's own mobile emulation is its default; desktop is its preset.
const FORM_FACTOR_FLAGS = { desktop: '--preset=desktop', mobile: '--form-factor=mobile' } as const;
type FormFactor = keyof typeof FORM_FACTOR_FLAGS;

interface LighthouseConfig {
  urls: string[];
  chromeFlags: string;
  // Each form factor audited, with the lowest score each category may reach on it.
  minScores: Partial<Record<FormFactor, Record<string, number>>>;
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

// How each page is audited: the browser, and where its reports go.
interface AuditSetup {
  chromeFlags: string;
  chromePath: string;
  outDir: string;
  stamp: string;
}

// One page's table row and the floors it fell below; a page whose run failed has no version.
interface PageResult {
  row: (string | number)[];
  misses: string[];
  version?: string;
}

// One Lighthouse run, its reports written beside its log; the log's text, and the report
// when the run produced one.
function audit(url: string, formFactor: FormFactor, { chromeFlags, chromePath, outDir, stamp }: AuditSetup): { log: string; reportFile?: string } {
  const base = path.join(outDir, `${formFactor}-${slug(url)}-${stamp}`);
  // `lighthouse` resolves from node_modules/.bin, which mise puts on PATH.
  const result = spawnResult(
    'lighthouse',
    [
      url,
      '--output=json',
      '--output=html',
      `--output-path=${base}`,
      FORM_FACTOR_FLAGS[formFactor],
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

const missed = (scores: Record<string, Score>, minScores: Record<string, number>): string[] =>
  Object.entries(minScores).flatMap(([category, minScore]) => {
    const score = scores[category] ?? 0;
    return score < minScore ? [`${category} ${percent(score)} below ${percent(minScore)}`] : [];
  });

// Audits one page on one form factor and reports it to the log and the annotations.
function auditPage(url: string, formFactor: FormFactor, setup: AuditSetup, minScores: Record<string, number>): PageResult {
  const label = `${formFactor} ${slug(url)}`;
  const { log, reportFile } = audit(url, formFactor, setup);
  if (!reportFile) {
    const reason = firstFailureLine(log);
    status(label, `FAILED: ${reason}`);
    annotate('error', 'lighthouse', `${url} (${formFactor}): ${reason}`);
    return { row: [url, formFactor, '-', '-', '-', '-', '**FAIL**', reason], misses: [] };
  }

  const report = readJson<{
    lighthouseVersion: string;
    categories: Record<string, { score: Score } | undefined>;
  }>(reportFile);
  const scores: Record<string, Score> = Object.fromEntries(COLUMNS.map((name) => [name, report.categories[name]?.score ?? null]));
  const misses = missed(scores, minScores);
  for (const text of misses) annotate('error', 'lighthouse', `${url} (${formFactor}): ${text}`);

  const percents = COLUMNS.map((name) => percent(scores[name]));
  const problems = misses.join('; ');
  status(label, `${percents.join(' / ')}${problems ? ` (${problems})` : ''}`);
  return {
    row: [url, formFactor, ...percents, problems ? '**FAIL**' : 'pass', problems || 'at or above every floor'],
    misses,
    version: report.lighthouseVersion,
  };
}

async function main(): Promise<number> {
  cli({ usage: 'usage: node bin/lighthouse-check.ts\n\nRuns Lighthouse against the URLs in tests/lighthouse.json.' });

  const chromePath = process.env.CHROME_PATH || chromium.executablePath();
  if (!fs.existsSync(chromePath)) {
    console.error('Lighthouse browser missing. Run `mise exec -- playwright install chromium` or set CHROME_PATH.');
    return 1;
  }

  const { urls, chromeFlags, minScores } = readJson<LighthouseConfig>(path.join(root, 'tests/lighthouse.json'));
  const outDir = fromCheckoutCache('lighthouse');
  fs.mkdirSync(outDir, { recursive: true });
  // A UTC basic-format stamp (20260102T030405), safe in a file name.
  const stamp = Temporal.Now.plainDateTimeISO('UTC').toString({ smallestUnit: 'second' }).replace(/[-:]/g, '');
  const setup = { chromeFlags, chromePath, outDir, stamp };
  const formFactors = Object.entries(minScores) as [FormFactor, Record<string, number>][];

  const pages = formFactors.flatMap(([formFactor, floors]) => urls.map((url) => auditPage(url, formFactor, setup, floors)));
  const misses = pages.flatMap((page) => page.misses).length;
  const auditFailures = pages.filter((page) => page.version === undefined).length;
  const version = pages.findLast((page) => page.version)?.version ?? '';

  const floors = formFactors
    .map(
      ([formFactor, byCategory]) =>
        `${formFactor}: ${Object.entries(byCategory)
          .map(([category, minScore]) => `${category} ${percent(minScore)}`)
          .join(', ')}`,
    )
    .join('; ');

  appendSummary(
    [
      `## Lighthouse${version ? ` ${version}` : ''}`,
      '',
      misses === 0 && auditFailures === 0
        ? `${pages.length} audit(s) at or above every floor. Floors, ${floors}.`
        : `${auditFailures} audit execution failure(s), ${misses} score(s) below a floor across ${pages.length} audit(s). Floors, ${floors}.`,
      '',
      table(
        ['Page', 'Form factor', 'Performance', 'Accessibility', 'Best practices', 'SEO', 'Result', 'Detail'],
        pages.map(({ row }) => row),
      ),
    ].join('\n'),
  );

  if (misses > 0 || auditFailures > 0) {
    console.error(`\nfailed: ${auditFailures} Lighthouse audit execution failure(s), ${misses} score(s) below a floor`);
    return 1;
  }

  console.log(`\nok lighthouse ${version}: ${pages.length} audit(s) at or above every floor`);
  return 0;
}

if (import.meta.main) await exitWith('lighthouse-check', main);
