import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fromRoot } from '../../../src/lib/site-root.ts';

// Runs a bin/ job-summary script as a GitHub Actions step would, with its summary copied to a
// file in dir, and returns that summary and the step's stdout (its annotations).
export function runSummaryScript(script: string, args: string[], dir: string, env: NodeJS.ProcessEnv = {}): { summary: string; stdout: string } {
  const summary = path.join(dir, 'summary.md');
  const result = spawnSync(process.execPath, [fromRoot(script), ...args], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: '', JOB_SUMMARY_FILE: summary, ...env },
  });
  assert.equal(result.status, 0, result.stderr);
  return { summary: fs.readFileSync(summary, 'utf8'), stdout: result.stdout };
}
