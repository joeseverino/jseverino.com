// Turn the JSON reports `mise run --report-file` writes for `mise run check`'s phases, one per
// phase in GATE_REPORT_DIR (mise-tasks/check), into one job-summary table and an error
// annotation per failed task. Runs with `if: always()` and exits zero on any report it can read:
// the gate step decides the job's outcome.

import fs from 'node:fs';
import path from 'node:path';
import { readJson } from '../src/lib/json.ts';
import { cli, usageError } from './lib/args.ts';
import { annotate, appendSummary, createReport, seconds, status } from './lib/step-summary.ts';

const usage = 'usage: GATE_REPORT_DIR=<dir> node bin/gate-summary.ts';
cli({ usage });
const dir = process.env.GATE_REPORT_DIR || usageError(usage, 'GATE_REPORT_DIR must be set');

// Version 1 of mise's report, the one this script reads.
interface TaskReport {
  name: string;
  status: 'passed' | 'failed' | 'cancelled' | 'skipped' | 'cached' | 'not_run';
  exit_code: number | null;
  duration_ms: number | null;
}

interface RunReport {
  version: number;
  started_at: string;
  duration_ms: number;
  tasks: TaskReport[];
}

const runs = (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
  .filter((file) => file.endsWith('.json'))
  .map((file) => {
    const report = readJson<RunReport>(path.join(dir, file));
    if (report.version !== 1) throw new Error(`${file}: mise report version ${report.version}; this script reads version 1`);
    return report;
  })
  .sort((a, b) => a.started_at.localeCompare(b.started_at));
const tasks = runs.flatMap((run) => run.tasks);

// A cancelled task (a timeout, an interrupted run) never passed, so it fails like a nonzero exit;
// one the run never reached is neither.
function outcome(task: TaskReport): [ok: boolean | null, detail: string] {
  const took = task.duration_ms === null ? '' : seconds(task.duration_ms);
  if (task.status === 'passed' || task.status === 'cached') return [true, took];
  if (task.status === 'failed') return [false, `exit ${task.exit_code} after ${took}`];
  if (task.status === 'cancelled') return [false, `cancelled after ${took}`];
  return [null, task.status.replace('_', ' ')];
}

const report = createReport('Gates', 'Task');
for (const task of tasks) report.add(task.name, ...outcome(task));
const failed = report.failed().map((row) => row.label);

const duration = seconds(runs.reduce((total, run) => total + run.duration_ms, 0));
const headline =
  failed.length === 0
    ? `All ${tasks.length} tasks passed in ${duration}.`
    : `${failed.length} of ${tasks.length} tasks failed: ${failed.map((name) => `\`${name}\``).join(', ')}.`;
const markdown = tasks.length === 0 ? '## Gates\n\nNo gate report was written: the run stopped before its first task.' : report.markdown(headline);

for (const name of failed) annotate('error', name, `${name} failed: its output is the log lines labeled [${name}].`);
status('gates', tasks.length === 0 ? 'no report' : headline);
if (!appendSummary(markdown)) console.log(markdown);
