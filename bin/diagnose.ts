#!/usr/bin/env node
// Collect-all gate: run every check, then report all failures in one pass to
// .validation-report.md (clipped excerpts plus the rerun command).
import fs from 'node:fs';
import path from 'node:path';
import { AUDITS, auditsFor, type Audit } from '../tests/audits/registry.ts';
import { browserTestEnv } from '../tests/browser-test-env.ts';
import { styleText } from 'node:util';
import { cli, flag } from './lib/args.ts';
import { runAudits, type AuditResult, type RunAuditOptions } from './lib/audits.ts';
import { statusEntries } from './lib/git.ts';
import { preflight, type PreflightCheck } from './lib/preflight.ts';
import { BUILD_TIMEOUT_MS, SYNC_TIMEOUT_MS, run, type RunOptions, type RunResult } from './lib/run.ts';
import { siteRoot as root } from '../src/lib/site-root.ts';

const reportPath = path.join(root, '.validation-report.md');

// Orchestration-only checks (build, idempotence) carry their own `fix`.
type Check = Pick<AuditResult, 'id' | 'name' | 'skipped' | 'code' | 'stdout' | 'stderr' | 'duration'> & {
  rerun?: string;
  fix?: string;
};

export type DiagnoseDocument =
  | {
      ok: boolean;
      failed: string[];
      report: string | null;
      checks: {
        id: string;
        name: string;
        status: 'skip' | 'pass' | 'fail';
        durationMs: number;
        rerun?: string | undefined;
        fix?: string;
      }[];
    }
  | { ok: false; failed: ['setup']; report: string; setup: string }
  | { ok: false; failed: ['preflight']; preflight: PreflightCheck[] };

const emit = (document: DiagnoseDocument): void => console.log(JSON.stringify(document, null, 2));

const fixFor = (id: string): string => AUDITS.find((a) => a.id === id)?.fix ?? 'Inspect error logs.';

const { values } = cli({
  usage: 'usage: node bin/diagnose.ts [--fast | --no-tests] [--json]',
  options: {
    fast: flag,
    'no-tests': flag,
    json: flag,
  },
});
const runTests = !values.fast && !values['no-tests'];
const runBuild = !values.fast;
const jsonMode = values.json;

const say: (text: string) => void = jsonMode ? () => {} : (text) => console.log(text);
const sayErr: (text: string) => void = jsonMode ? () => {} : (text) => console.error(text);

const runCommand = (cmd: string, cmdArgs: readonly string[], options: RunOptions = {}): Promise<RunResult> => run(cmd, cmdArgs, { cwd: root, ...options });


const getGitStatus = (): string => statusEntries(root).join('\n');

function postBuildOptions(audit: Audit): RunAuditOptions {
  return {
    ...(audit.id === 'browser-tests' && !jsonMode
      ? {
          heartbeatMs: 30_000,
          onHeartbeat: (elapsed: number) => say(styleText('dim', `  [WAIT] Playwright still running (${Math.round(elapsed / 1000)}s)`)),
        }
      : {}),
  };
}

function printResult(res: Check): void {
  const statusText = res.skipped ? styleText('yellow', '[SKIP]') : res.code === 0 ? styleText('green', '[PASS]') : styleText('red', '[FAIL]');
  say(`  ${statusText} ${res.name} (${res.duration}ms)`);
}


function clipOutput(text: string, head = 20, tail = 60): string {
  const lines = text.trim().split('\n');
  if (lines.length <= head + tail + 1) return text.trim();
  return [
    ...lines.slice(0, head),
    `… ${lines.length - head - tail} lines elided; the rerun command above prints the full output …`,
    ...lines.slice(-tail),
  ].join('\n');
}

function emitJson(checks: readonly Check[], failedChecks: readonly Check[]): void {
  emit({
    ok: failedChecks.length === 0,
    failed: failedChecks.map((c) => c.id),
    report: failedChecks.length > 0 ? path.relative(root, reportPath) : null,
    checks: checks.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.skipped ? 'skip' : c.code === 0 ? 'pass' : 'fail',
      durationMs: c.duration,
      ...(c.code !== 0 && !c.skipped ? { rerun: c.rerun, fix: c.fix ?? fixFor(c.id) } : {}),
    })),
  });
}

function renderSetupFailure(name: string, output: string): string {
  return [
    '# Codebase Diagnostics & Issues Report',
    '',
    '> [!CAUTION]',
    `> ${name} failed. The verification pipeline cannot proceed.`,
    '',
    `### ❌ ${name}`,
    '',
    '**Error Output**:',
    '```text',
    clipOutput(output),
    '```',
    '',
  ].join('\n');
}

function renderReport(checks: readonly Check[], failed: readonly Check[]): string {
  const recommendation = (check: Check): string => check.fix ?? fixFor(check.id);
  const status = (check: Check): string => (check.skipped ? '⚠️ SKIP' : check.code !== 0 ? '❌ FAIL' : '✅ PASS');
  const rows = checks.map((check) => `| **${check.name}** | ${status(check)} | ${check.duration}ms | ${recommendation(check)} |`);
  const details = failed.map((check) => {
    const output = [check.stdout, check.stderr].map((text) => (text ?? '').trim()).filter(Boolean).join('\n');
    return [
      `### ❌ ${check.name} (\`${check.id}\`)`,
      '',
      `**Action Item**: ${recommendation(check)}`,
      '',
      ...(check.rerun ? [`**Rerun**: \`${check.rerun}\``, ''] : []),
      '**Error Output**:',
      '```text',
      clipOutput(output),
      '```',
      '',
    ].join('\n');
  });
  return [
    '# Codebase Diagnostics & Issues Report',
    '',
    '> [!IMPORTANT]',
    '> This report lists all logical failures detected in the codebase by running deterministic test scripts. Fix these issues prior to pushing or deploying.',
    '',
    '## Validation Summary',
    '',
    '| Check Name | Status | Duration | Recommendation |',
    '| :--- | :--- | :--- | :--- |',
    ...rows,
    '',
    '---',
    '',
    '## Failure Details & Resolution Paths',
    '',
    ...details,
    '',
  ].join('\n');
}

function setupFailure(name: string, result: RunResult): number {
  sayErr(styleText('red', `❌ Setup failed: ${name} exited with code ${result.code}`, { stream: process.stderr }));
  const output = (result.stderr || result.stdout || '').trim();
  sayErr(output);
  fs.writeFileSync(reportPath, renderSetupFailure(name, output), 'utf8');
  if (jsonMode) emit({ ok: false, failed: ['setup'], report: path.relative(root, reportPath), setup: name });
  return 1;
}

// Returns an exit code when a step fails, otherwise null.
async function prepare(initialGitStatus: string): Promise<number | null> {
  say(styleText('blue', 'Phase 1: Syncing Content and Cleaning Caches...'));
  const clean = await runCommand('node', ['bin/clean-generated.ts']);
  if (clean.code !== 0) return setupFailure('Cache Clean (bin/clean-generated.ts)', clean);
  const sync = await runCommand('node', ['bin/sync-content.ts'], { timeout: SYNC_TIMEOUT_MS });
  if (sync.code !== 0) return setupFailure('Content Synchronization (sync:content)', sync);

  const postSyncGitStatus = getGitStatus();
  if (postSyncGitStatus === initialGitStatus) {
    say('✓ Caches cleared & content synced.\n');
    return null;
  }
  const before = new Set(initialGitStatus.split('\n').filter(Boolean));
  const drift = postSyncGitStatus.split('\n').filter((line) => line && !before.has(line));
  say(styleText('yellow', `Vault drift detected: ${drift.length} synced path${drift.length === 1 ? '' : 's'} changed before validation.`));
  for (const line of drift) say(`  ${line}`);
  say('Review with `git diff -- src/content public/assets` or publish the synced snapshot.\n');
  return null;
}

async function buildAndTest(checks: Check[]): Promise<void> {
  say(styleText('blue', 'Phase 3: Compiling Production Build...'));
  const build = await runCommand('node', ['bin/build-static.ts'], { env: browserTestEnv, timeout: BUILD_TIMEOUT_MS });
  const built = build.code === 0;
  say(`  ${built ? styleText('green', '[PASS]') : styleText('red', '[FAIL]')} Static Site Build (${build.duration}ms)\n`);
  checks.push({
    id: 'static-build', name: 'Production Static Build', skipped: false, ...build,
    rerun: 'npm run build:static',
    fix: 'Fix HTML/CSS/JS compile errors during the static site building process.',
  });
  if (!built) {
    say(styleText('yellow', 'Phase 4 Skipped: Static compilation failed.\n'));
    return;
  }

  say(styleText('blue', 'Phase 4: Running Post-Build Audits and Browser Tests...'));
  const postAudits = auditsFor('diagnose', 'post-build').filter((audit) => runTests || !audit.heavy);
  checks.push(...await runAudits(postAudits, { cwd: root, optionsFor: postBuildOptions, onResult: printResult }));
  say('');
}

function idempotenceCheck(initialGitStatus: string): Check {
  const finalGitStatus = getGitStatus();
  const mutated = finalGitStatus !== initialGitStatus;
  say(`  ${mutated ? styleText('red', '[FAIL]') : styleText('green', '[PASS]')} Worktree Idempotence Check\n`);
  return {
    id: 'idempotence-check', name: 'Workspace Idempotence', skipped: false,
    code: mutated ? 1 : 0,
    stdout: mutated ? `Git status changed during run:\nBefore:\n${initialGitStatus}\nAfter:\n${finalGitStatus}` : 'Worktree is clean.',
    stderr: '', duration: 0,
    rerun: 'git status --porcelain=v1',
    fix: 'Running tests and builds mutated tracked files in the workspace. Commit synced content or reset generated files before pushing.',
  };
}

function conclude(checks: readonly Check[], startedAt: number): number {
  const failed = checks.filter((check) => check.code !== 0 && !check.skipped);
  const seconds = Math.round((Date.now() - startedAt) / 1000);

  if (failed.length === 0) {
    const browserSkipped = checks.some((check) => check.id === 'browser-tests' && check.skipped);
    say(styleText(['bold', 'green'],
      browserSkipped
        ? `✓ ALL CHECKS PASSED in ${seconds}s. Static checks and build are clean; browser/visual suite skipped (run on macOS before deploy).`
        : `✓ ALL CHECKS PASSED in ${seconds}s. Codebase is logically clean and ready to deploy.`,
    ));
    fs.rmSync(reportPath, { force: true });
    if (jsonMode) emitJson(checks, failed);
    return 0;
  }

  sayErr(styleText(['bold', 'red'], `❌ ${failed.length} CHECKS FAILED in ${seconds}s.`, { stream: process.stderr }));
  say(`Writing diagnostic report to: ${styleText('bold', '.validation-report.md')}\n`);
  fs.writeFileSync(reportPath, renderReport(checks, failed), 'utf8');
  if (jsonMode) emitJson(checks, failed);
  return 1;
}

async function diagnose(): Promise<number> {
  const startedAt = Date.now();
  say(styleText('bold', 'Starting Deterministic E2E Codebase Diagnosis...\n'));

  const ready = await preflight(process.env.CI ? ['deps'] : ['deps', 'vault'], { root });
  if (!ready.ok) {
    for (const check of ready.failed) sayErr(styleText('red', `preflight: ${check.detail}\n  fix: ${check.fix}`, { stream: process.stderr }));
    if (jsonMode) emit({ ok: false, failed: ['preflight'], preflight: ready.checks });
    return 3;
  }

  const initialGitStatus = getGitStatus();
  const setup = await prepare(initialGitStatus);
  if (setup !== null) return setup;

  const checks: Check[] = [];
  say(styleText('blue', 'Phase 2: Running Static Audits and Policy Checks...'));
  checks.push(...await runAudits(auditsFor('diagnose', 'pre-build'), { cwd: root, onResult: printResult }));
  say('');

  if (runBuild) {
    await buildAndTest(checks);
    checks.push(idempotenceCheck(initialGitStatus));
  } else {
    say(styleText('yellow', 'Phases 3 & 4 Skipped (--fast flag provided).\n'));
  }
  return conclude(checks, startedAt);
}

process.exitCode = await diagnose().catch((error: unknown) => {
  console.error('Diagnostic harness error:', error);
  return 1;
});
