import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { fromRoot } from '../../src/lib/site-root.ts';
import { scratchDirs } from './helpers/fs.ts';
import { runSummaryScript } from './helpers/summary-script.ts';

const dirs = scratchDirs('gate-summary-');
after(dirs.cleanup);

// Each fixture is a report `mise run --report-file` wrote: a passing run, a run cut off by
// --timeout with one gate failed and one cancelled, and a run that stopped before a task.
function summarize(...fixtures: string[]): { summary: string; stdout: string } {
  const dir = dirs.make();
  const reports = path.join(dir, 'gates');
  fs.mkdirSync(reports);
  for (const fixture of fixtures) fs.copyFileSync(fromRoot(`tests/fixtures/mise-report/${fixture}.json`), path.join(reports, `${fixture}.json`));
  return runSummaryScript('bin/gate-summary.ts', [], dir, { GATE_REPORT_DIR: reports });
}

test('a passing run says every gate passed and annotates nothing', () => {
  const { summary, stdout } = summarize('passed');
  assert.match(summary, /^All 2 tasks passed in /m);
  assert.match(summary, /^\| `built:links` \| pass \|/m);
  assert.doesNotMatch(stdout, /^::error/m);
});

test('the headline and one error annotation name each gate that failed or was cancelled', () => {
  const { summary, stdout } = summarize('passed', 'timed-out');
  assert.match(summary, /^2 of 6 tasks failed: `checks:slow`, `checks:types`\.$/m);
  assert.match(summary, /^\| `checks:types` \| \*\*FAIL\*\* \| exit 2 after /m);
  assert.match(summary, /^\| `checks:slow` \| \*\*FAIL\*\* \| cancelled after /m);
  assert.deepEqual(
    stdout
      .split('\n')
      .filter((line) => line.startsWith('::error'))
      .map((line) => line.split('::')[1]),
    ['error title=checks%3Aslow', 'error title=checks%3Atypes'],
  );
});

test('a task the run never reached is listed as not run, never as passed', () => {
  const { summary } = summarize('not-run');
  assert.match(summary, /^\| `after` \| skipped \| not run \|$/m);
  assert.match(summary, /^1 of 2 tasks failed: `build`\.$/m);
});

test('a run that wrote no report says the gates never started', () => {
  const { summary } = summarize();
  assert.match(summary, /^No gate report was written/m);
});
