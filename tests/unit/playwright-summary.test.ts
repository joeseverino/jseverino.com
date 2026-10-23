import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import type { JSONReportSpec, JSONReportTest } from '@playwright/test/reporter';
import { fromRoot } from '../../src/lib/site-root.ts';
import { scratchDirs, write } from './helpers/fs.ts';

const dirs = scratchDirs('playwright-summary-');
after(dirs.cleanup);

// The fields bin/playwright-summary.ts reads, in the shape Playwright's JSON reporter writes.
const spec = (title: string, status: JSONReportTest['status']): Partial<JSONReportSpec> => ({
  title,
  file: 'smoke.spec.ts',
  tests: [{ projectName: 'chromium-desktop', status, results: [{ duration: 1000 }] } as JSONReportTest],
});

function summarize(specs: Partial<JSONReportSpec>[]): { summary: string; stdout: string } {
  const dir = dirs.make();
  const report = path.join(dir, 'e2e.json');
  const summary = path.join(dir, 'summary.md');
  write(report, JSON.stringify({ suites: [{ title: 'smoke.spec.ts', specs }], stats: { duration: 3000 } }));
  const result = spawnSync(process.execPath, [fromRoot('bin/playwright-summary.ts'), 'Cross-browser suite', report], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: '', JOB_SUMMARY_FILE: summary },
  });
  assert.equal(result.status, 0, result.stderr);
  return { summary: fs.readFileSync(summary, 'utf8'), stdout: result.stdout };
}

test('a test that passed only on retry is reported as failing the run, with an error annotation', () => {
  const { summary, stdout } = summarize([spec('home renders', 'expected'), spec('menu opens', 'flaky')]);
  assert.doesNotMatch(summary, /passed in/);
  assert.match(summary, /1 flaky .*fails the run/);
  assert.match(stdout, /^::error title=playwright%3A chromium-desktop::flaky: smoke\.spec\.ts › menu opens$/m);
});

test('a skipped test is never counted among the passed', () => {
  const { summary } = summarize([spec('home renders', 'expected'), spec('forced colors', 'skipped')]);
  assert.match(summary, /^1 tests passed and 1 skipped /m);
});

// Playwright passes a test that failed and then passed on retry unless the config says otherwise,
// so every suite that can retry in CI must fail on a flaky result.
test('every Playwright config that retries in CI fails the run on a flaky test', () => {
  const configs = fs.globSync('tests/playwright*.config.ts', { cwd: fromRoot() });
  assert.ok(configs.length > 0);
  const script = `const { default: config } = await import(process.argv[1]); console.log(JSON.stringify(config));`;
  for (const config of configs) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, fromRoot(config)], {
      cwd: fromRoot(),
      encoding: 'utf8',
      env: { ...process.env, CI: '1' },
    });
    assert.equal(result.status, 0, result.stderr);
    const { retries = 0, failOnFlakyTests = false } = JSON.parse(result.stdout) as { retries?: number; failOnFlakyTests?: boolean };
    assert.ok(retries === 0 || failOnFlakyTests, `${config} retries ${retries} time(s) in CI without failOnFlakyTests`);
  }
});
