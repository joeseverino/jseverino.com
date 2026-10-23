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
  .map(([project, row]) => [project, row.passed, row.failed === 0 ? '0' : `**${row.failed}**`, row.flaky, row.skipped, seconds(row.duration)]);

const stats: Partial<JSONReport['stats']> = report.stats ?? {};
const failed = tests.filter((test) => test.status === 'unexpected');
const flaky = tests.filter((test) => test.status === 'flaky');

for (const [project, row] of byProject) {
  status(project, `${row.passed} passed, ${row.failed} failed, ${row.flaky} flaky, ${row.skipped} skipped in ${seconds(row.duration)}`);
}

const projects = `${byProject.size} ${byProject.size === 1 ? 'project' : 'projects'}`;
const headline =
  failed.length === 0
    ? `${tests.length} tests across ${projects} passed in ${seconds(stats.duration ?? 0)}.`
    : `${failed.length} of ${tests.length} tests failed across ${projects}.`;

const sections = [`## ${cell(title)}`, '', headline, '', table(['Project', 'Passed', 'Failed', 'Flaky', 'Skipped', 'Duration'], rows)];

if (failed.length > 0) {
  sections.push('', '### Failed', '');
  for (const test of failed.slice(0, 20)) {
    sections.push(`- \`${cell(test.file)}\` › ${cell(test.title)} (${cell(test.project)})`);
    annotate('error', `playwright: ${test.project}`, `${test.file} › ${test.title}`);
  }
  if (failed.length > 20) sections.push(`- and ${failed.length - 20} more`);
}

if (flaky.length > 0) {
  sections.push('', '### Passed on retry', '');
  for (const test of flaky.slice(0, 20)) {
    sections.push(`- \`${cell(test.file)}\` › ${cell(test.title)} (${cell(test.project)})`);
  }
}

appendSummary(sections.join('\n'));
