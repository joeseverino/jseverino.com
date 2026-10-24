#!/usr/bin/env node

// Turn Playwright's JSON report into a per-project job-summary table. Runs with
// `if: always()` and exits zero: the test step decides the job's outcome.
//
//   node bin/playwright-summary.ts "Cross-browser suite" .cache/test-results/e2e.json

import fs from 'node:fs';
import path from 'node:path';
import type { JSONReport, JSONReportSuite } from '@playwright/test/reporter';
import { readJson } from '../src/lib/json.ts';
import { siteRoot as root } from '../src/lib/site-root.ts';
import { cli } from './lib/args.ts';
import { annotate, appendSummary, cell, status, table } from './lib/step-summary.ts';

// Each suite writes its own report (tests/browser-test-env.ts), so the caller names it.
const usage = 'usage: node bin/playwright-summary.ts <title> <report.json>';
const [title, reportFile, ...extra] = cli({ usage, allowPositionals: true }).positionals;
if (!title || !reportFile || extra.length) {
  console.error(usage);
  process.exit(2);
}
const input = path.resolve(root, reportFile);

interface TestRow {
  project: string;
  status: string;
  duration: number;
  title: string;
  file: string;
}

function collect(suite: JSONReportSuite, out: TestRow[]): void {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      out.push({
        project: test.projectName ?? 'default',
        status: test.status,
        duration: (test.results ?? []).reduce((total, result) => total + (result.duration ?? 0), 0),
        title: spec.title,
        file: spec.file,
      });
    }
  }
  for (const child of suite.suites ?? []) collect(child, out);
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

// A count that fails the run stands out in its table cell.
const strong = (count: number): string => (count === 0 ? '0' : `**${count}**`);

function display(file: string): string {
  const relative = path.relative(root, file);
  return relative.startsWith('..') ? file : relative;
}

if (!fs.existsSync(input)) {
  status('playwright', `no JSON report at ${display(input)}; the suite did not reach its reporter`);
  appendSummary(`## ${cell(title)}\n\nNo JSON report was produced, so the suite did not reach its reporter.`);
  process.exit(0);
}

const report = readJson<Partial<JSONReport>>(input);
const tests: TestRow[] = [];
for (const suite of report.suites ?? []) collect(suite, tests);

function tally(runs: TestRow[]) {
  const count = (status: string): number => runs.filter((test) => test.status === status).length;
  const [passed, failed, flaky] = [count('expected'), count('unexpected'), count('flaky')];
  const duration = runs.reduce((total, test) => total + test.duration, 0);
  return { passed, failed, flaky, skipped: runs.length - passed - failed - flaky, duration };
}

const byProject = new Map(
  Map.groupBy(tests, (test) => test.project)
    .entries()
    .map(([project, runs]) => [project, tally(runs)]),
);

const rows = [...byProject.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([project, row]) => [project, row.passed, strong(row.failed), strong(row.flaky), row.skipped, seconds(row.duration)]);

const stats: Partial<JSONReport['stats']> = report.stats ?? {};
const failed = tests.filter((test) => test.status === 'unexpected');
const flaky = tests.filter((test) => test.status === 'flaky');

for (const [project, row] of byProject) {
  status(project, `${row.passed} passed, ${row.failed} failed, ${row.flaky} flaky, ${row.skipped} skipped in ${seconds(row.duration)}`);
}

// A flaky test passed only on retry, which fails the run (failOnFlakyTests), so the headline
// never calls it passed, and a skipped test is never counted as one that passed. A run that
// stopped early (a global timeout, a web server or setup error) reports its tests as skipped
// and its cause in report.errors, so an error also fails the headline.
const projects = `${byProject.size} ${byProject.size === 1 ? 'project' : 'projects'}`;
const total = tally(tests);
const errors = report.errors ?? [];
const problems = [
  [failed.length, 'failed'],
  [flaky.length, 'flaky'],
  [errors.length, errors.length === 1 ? 'run error' : 'run errors'],
] as const;
const counted = problems.filter(([count]) => count > 0).map(([count, label]) => `${count} ${label}`);
const headline =
  counted.length === 0
    ? `${total.passed} tests passed and ${total.skipped} skipped across ${projects} in ${seconds(stats.duration ?? 0)}.`
    : `${counted.join(', ')} across ${tests.length} tests in ${projects}; the run fails.`;

const sections = [`## ${cell(title)}`, '', headline, '', table(['Project', 'Passed', 'Failed', 'Flaky', 'Skipped', 'Duration'], rows)];

function list(heading: string, runs: TestRow[], verdict: string): void {
  if (runs.length === 0) return;
  sections.push('', `### ${heading}`, '');
  for (const test of runs.slice(0, 20)) {
    sections.push(`- \`${cell(test.file)}\` › ${cell(test.title)} (${cell(test.project)})`);
    annotate('error', `playwright: ${test.project}`, `${verdict}: ${test.file} › ${test.title}`);
  }
  if (runs.length > 20) sections.push(`- and ${runs.length - 20} more`);
}

list('Failed', failed, 'failed');
list('Flaky: passed only on retry', flaky, 'flaky');

if (errors.length > 0) {
  sections.push('', '### Run errors', '');
  for (const error of errors) {
    const message = (error.message ?? 'unknown error').split('\n')[0] ?? '';
    sections.push(`- ${cell(message)}`);
    annotate('error', 'playwright', message);
  }
}

appendSummary(sections.join('\n'));
