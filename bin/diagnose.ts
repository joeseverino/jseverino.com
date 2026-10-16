#!/usr/bin/env node
// Collect-all gate: run every check, then report all failures in one pass to
// .validation-report.md (clipped excerpts plus the rerun command).
import fs from 'node:fs';
import path from 'node:path';
import { styleText } from 'node:util';
import { AUDITS, diagnosticAudits, type Audit } from '../tests/audits/registry.ts';
import { browserTestEnv } from '../tests/browser-test-env.ts';
import { errorMessage } from '../src/lib/error-message.ts';
import { cli, exitWith, flag } from './lib/args.ts';
import { runAudits, type AuditResult, type RunAuditOptions } from './lib/audits.ts';
import { statusEntries } from './lib/git.ts';
import { preflight, type PreflightCheck } from './lib/preflight.ts';
import { BUILD_TIMEOUT_MS, run } from './lib/run.ts';
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
  | { ok: false; failed: ['preflight']; preflight: PreflightCheck[] }
  | { ok: false; failed: ['harness']; error: string };

const emit = (document: DiagnoseDocument): void => console.log(JSON.stringify(document, null, 2));

const fixFor = (id: string): string => AUDITS.find((a) => a.id === id)?.fix ?? 'Read the output below and rerun the check.';

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

const getGitStatus = (): string => statusEntries(root).join('\n');

function postBuildOptions(audit: Audit): RunAuditOptions {
  return {
    ...(audit.id === 'browser-tests' && !jsonMode
      ? {
          heartbeatMs: 30_000,
          onHeartbeat: (elapsed: number) => say(styleText('dim', `  WAIT Playwright still running (${Math.round(elapsed / 1000)}s)`)),
        }
      : {}),
  };
}

function printResult(res: Check): void {
  const statusText = res.skipped ? styleText('yellow', 'SKIP') : res.code === 0 ? styleText('green', 'PASS') : styleText('red', 'FAIL');
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

function renderReport(checks: readonly Check[], failed: readonly Check[]): string {
  const recommendation = (check: Check): string => check.fix ?? fixFor(check.id);
  const status = (check: Check): string => (check.skipped ? 'SKIP' : check.code !== 0 ? 'FAIL' : 'PASS');
  const rows = checks.map((check) => `| ${check.name} | ${status(check)} | ${check.duration}ms | ${recommendation(check)} |`);
  const details = failed.map((check) => {
    const output = [check.stdout, check.stderr].map((text) => (text ?? '').trim()).filter(Boolean).join('\n');
    return [
      `### ${check.name} (\`${check.id}\`)`,
      '',
      `Fix: ${recommendation(check)}`,
      '',
      ...(check.rerun ? [`Rerun: \`${check.rerun}\``, ''] : []),
      'Output:',
      '```text',
      clipOutput(output),
      '```',
      '',
    ].join('\n');
  });
  return [
    '# Diagnose report',
    '',
    '## Summary',
    '',
    '| Check | Status | Duration | Fix |',
    '| :--- | :--- | :--- | :--- |',
    ...rows,
    '',
    '## Failures',
    '',
    ...details,
    '',
  ].join('\n');
}

async function buildAndTest(checks: Check[]): Promise<void> {
  say(styleText('blue', 'Build'));
  const build = await run(process.execPath, ['bin/build-static.ts'], { cwd: root, env: browserTestEnv, timeout: BUILD_TIMEOUT_MS });
  const built = build.code === 0;
  say(`  ${built ? styleText('green', 'PASS') : styleText('red', 'FAIL')} Static build (${build.duration}ms)\n`);
  checks.push({
    id: 'static-build', name: 'Static build', skipped: false, ...build,
    rerun: 'npm run build:static',
    fix: 'Rerun npm run build:static and fix the first error it reports.',
  });
  if (!built) {
    say(styleText('yellow', 'Post-build checks skipped: the build failed.\n'));
    return;
  }

  say(styleText('blue', 'Post-build checks'));
  const postAudits = diagnosticAudits('post-build', { browsers: runTests });
  checks.push(...await runAudits(postAudits, { cwd: root, optionsFor: postBuildOptions, onResult: printResult }));
  say('');
}

function idempotenceCheck(initialGitStatus: string): Check {
  const finalGitStatus = getGitStatus();
  const mutated = finalGitStatus !== initialGitStatus;
  say(`  ${mutated ? styleText('red', 'FAIL') : styleText('green', 'PASS')} Worktree unchanged\n`);
  return {
    id: 'idempotence-check', name: 'Worktree unchanged', skipped: false,
    code: mutated ? 1 : 0,
    stdout: mutated ? `Git status changed during run:\nBefore:\n${initialGitStatus}\nAfter:\n${finalGitStatus}` : 'Worktree is clean.',
    stderr: '', duration: 0,
    rerun: 'git status --porcelain=v1',
    fix: 'The run changed tracked files. Commit synced content or reset generated files, then rerun.',
  };
}

function conclude(checks: readonly Check[], startedAt: number): number {
  const failed = checks.filter((check) => check.code !== 0 && !check.skipped);
  const seconds = Math.round((Date.now() - startedAt) / 1000);

  if (failed.length === 0) {
    const skipped = checks.filter((check) => check.skipped);
    const scope = !runBuild
      ? 'Pre-build checks passed; build and browser suites were not run.'
      : !runTests
        ? 'Static checks and build passed; browser suites were not run.'
        : 'Static checks, build, and available browser suites passed.';
    say(styleText(['bold', 'green'], `PASS in ${seconds}s. ${scope}`));
    if (skipped.length) say(`Skipped: ${skipped.map((check) => check.name).join(', ')}.`);
    fs.rmSync(reportPath, { force: true });
    if (jsonMode) emitJson(checks, failed);
    return 0;
  }

  sayErr(styleText(['bold', 'red'], `FAIL: ${failed.length} of ${checks.length} checks in ${seconds}s.`, { stream: process.stderr }));
  say(`Report: ${styleText('bold', '.validation-report.md')}\n`);
  fs.writeFileSync(reportPath, renderReport(checks, failed), 'utf8');
  if (jsonMode) emitJson(checks, failed);
  return 1;
}

async function diagnose(): Promise<number> {
  const startedAt = Date.now();
  say(styleText('bold', 'diagnose\n'));

  const ready = await preflight(['deps'], { root });
  if (!ready.ok) {
    for (const check of ready.failed) sayErr(styleText('red', `preflight: ${check.detail}\n  fix: ${check.fix}`, { stream: process.stderr }));
    if (jsonMode) emit({ ok: false, failed: ['preflight'], preflight: ready.checks });
    return 3;
  }

  const initialGitStatus = getGitStatus();
  say('Validating the current snapshot; content sync is a separate command.\n');

  const checks: Check[] = [];
  say(styleText('blue', 'Static checks'));
  checks.push(...await runAudits(diagnosticAudits('pre-build'), { cwd: root, onResult: printResult }));
  say('');

  if (runBuild) {
    await buildAndTest(checks);
  } else {
    say(styleText('yellow', 'Build and post-build checks skipped (--fast).\n'));
  }
  checks.push(idempotenceCheck(initialGitStatus));
  return conclude(checks, startedAt);
}

await exitWith('diagnose', () => diagnose().catch((error: unknown) => {
  if (jsonMode) emit({ ok: false, failed: ['harness'], error: errorMessage(error) });
  throw error;
}));
