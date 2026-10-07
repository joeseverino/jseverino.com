#!/usr/bin/env node
// The fast local build gate: clean, sync, pre-build audits, production build,
// post-build audits. Fail-fast; each phase's audits run concurrently.
import { publishAudits, type Audit } from '../tests/audits/registry.ts';
import { cli, flag } from './lib/args.ts';
import { runAudits } from './lib/audits.ts';
import { firstFailureLine } from './lib/audit-summary.ts';
import { contentDiff, describeDiff } from './content-diff.ts';
import { BUILD_TIMEOUT_MS, SYNC_TIMEOUT_MS, run as spawnRun, status as printStatus, type RunOptions, type RunResult } from './lib/run.ts';
import { annotate, createReport, type Outcome } from './lib/step-summary.ts';
import { siteRoot } from '../src/lib/site-root.ts';

// --no-sync skips the vault sync, so code changes verify without vault drift.
// --after-gate skips audits gate:check already ran; on the runner the edge suite
// also runs in its own job.
const { values } = cli({
  usage: 'usage: node bin/publish-check.ts [--no-sync] [--after-gate]',
  options: { 'no-sync': flag, 'after-gate': flag },
});
const noSync = values['no-sync'];
const selection = { afterGate: values['after-gate'], ci: Boolean(process.env.CI) };
const node = process.execPath;
const report = createReport('Publish gate');

function status(label: string, detail: string, ok: Outcome = true): void {
  report.add(label, ok, detail);
  printStatus(label, detail);
}

const writeSummary = () => report.write(report.failed().length === 0
  ? `All ${report.rows.length} steps passed.`
  : `Stopped at the first failure after ${report.rows.length} steps.`);

function stop(label: string, result: RunResult & { detail: string }): never {
  report.add(label, false, result.detail);
  annotate('error', `publish-check: ${label}`, result.detail);
  writeSummary();
  console.error(`\nfailed: ${label}`);
  if (result.stdout.trim()) console.error(`\nstdout:\n${result.stdout.trimEnd()}`);
  if (result.stderr.trim()) console.error(`\nstderr:\n${result.stderr.trimEnd()}`);
  process.exit(result.code);
}

async function step(label: string, args: readonly string[], options: RunOptions = {}): Promise<RunResult> {
  const result = await spawnRun(node, args, { cwd: siteRoot, ...options });
  if (result.code !== 0) stop(label, { ...result, detail: firstFailureLine(result.output) });
  return result;
}

async function audits(entries: readonly Audit[]): Promise<void> {
  const results = await runAudits(entries, {
    stopOnFailure: true,
    onResult: (result, entry) => {
      if (result.ok !== false) status(entry.label, result.detail, result.ok);
    },
  });
  const last = results.at(-1);
  const entry = entries[results.length - 1];
  if (last?.ok === false && entry) stop(entry.label, last);
}

await step('clean generated output', ['bin/clean-generated.ts']);

if (noSync) {
  status('sync', 'skipped (--no-sync)', null);
} else {
  await step('sync content', ['bin/sync-content.ts'], { timeout: SYNC_TIMEOUT_MS });
  status('sync', 'content snapshot updated');
}
status('content', describeDiff(contentDiff({ cwd: siteRoot })));

// astro-check needs the sync, so pre-build audits run after it.
await audits(publishAudits('pre-build', selection));

const build = await step('build static', ['bin/build-static.ts'], {
  env: { ASTRO_TELEMETRY_DISABLED: '1' },
  timeout: BUILD_TIMEOUT_MS,
});
// `[build] N page(s) built`, or {"message":"N page(s) built …"} under SITE_JSON.
const pageCount = build.output.match(/(?:\[build\] |"message":")(\d+) page\(s\) built/);
status('build', pageCount ? `${pageCount[1]} pages built` : 'completed');

await audits(publishAudits('post-build', selection));

writeSummary();
