#!/usr/bin/env node
// The collect-all gate: run every check, then report everything that is wrong
// in one pass. Success prints one line; failure writes .validation-report.md
// with a clipped excerpt of each failure plus the exact command to rerun it.
import fs from 'node:fs';
import path from 'node:path';
import { AUDITS, auditsFor, type Audit } from '../tests/audits/registry.ts';
import { browserTestEnv } from '../tests/browser-test-env.ts';
import { styleText } from 'node:util';
import { cli } from './lib/args.ts';
import { runAudits, type AuditResult, type RunAuditOptions } from './lib/audits.ts';
import { preflight, type PreflightCheck } from './lib/preflight.ts';
import { SYNC_TIMEOUT_MS, run, type RunOptions, type RunResult } from './lib/run.ts';
import { siteRoot as root } from '../src/lib/site-root.ts';

const reportPath = path.join(root, '.validation-report.md');

// Remediation text comes from the registry; orchestration-only checks (build,
// idempotence) carry their own `fix` on the result object.
// One row of the report: a registry audit's result, or an orchestration step's.
type Check = Pick<AuditResult, 'id' | 'name' | 'skipped' | 'code' | 'stdout' | 'stderr' | 'duration'> & {
  rerun?: string;
  fix?: string;
};

// The --json document.
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
    fast: { type: 'boolean', default: false },
    'no-tests': { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
  },
});
const runTests = !values.fast && !values['no-tests'];
const runBuild = !values.fast;
const jsonMode = values.json;

// In --json mode the only stdout is the final JSON document.
const say: (text: string) => void = jsonMode ? () => {} : (text) => console.log(text);
const sayErr: (text: string) => void = jsonMode ? () => {} : (text) => console.error(text);

const runCommand = (cmd: string, cmdArgs: readonly string[], options: RunOptions = {}): Promise<RunResult> => run(cmd, cmdArgs, { cwd: root, ...options });

// --no-tests skips every browser suite; only the two that serve the Phase 3
// build take PREBUILT.
const BROWSER_SUITES = new Set(['browser-tests', 'visual-tests']);
const PREBUILT_SUITES = new Set(['browser-tests', 'edge-tests']);

async function getGitStatus(): Promise<string> {
  const result = await runCommand('git', ['status', '--porcelain=v1']);
  return result.stdout.trim();
}

// Playwright's long quiet browser run gets a heartbeat; the suites that serve
// the Phase 3 build take PREBUILT.
function postBuildOptions(audit: Audit): RunAuditOptions {
  return {
    ...(PREBUILT_SUITES.has(audit.id) ? { env: { PREBUILT: '1' } } : {}),
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


// Keep the report reviewable when a check (Playwright especially) dumps
// thousands of lines: keep the head and tail, point at the rerun command.
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

function setupFailure(name: string, result: RunResult): never {
  sayErr(styleText('red', `❌ Setup failed: ${name} exited with code ${result.code}`, { stream: process.stderr }));
  const errorOutput = (result.stderr || result.stdout || '').trim();
  sayErr(errorOutput);

  let markdown = `# Codebase Diagnostics & Issues Report\n\n`;
  markdown += `> [!CAUTION]\n`;
  markdown += `> ${name} failed. The verification pipeline cannot proceed.\n\n`;
  markdown += `### ❌ ${name}\n\n`;
  markdown += `**Error Output**:\n\`\`\`text\n${clipOutput(errorOutput)}\n\`\`\`\n`;
  fs.writeFileSync(reportPath, markdown, 'utf8');
  if (jsonMode) {
    emit({ ok: false, failed: ['setup'], report: path.relative(root, reportPath), setup: name });
  }
  process.exit(1);
}

async function diagnose() {
  const startedAt = Date.now();
  say(styleText('bold', 'Starting Deterministic E2E Codebase Diagnosis...\n'));

  // Stale dependencies or a missing vault stop here, within seconds.
  const ready = await preflight(process.env.CI ? ['deps'] : ['deps', 'vault'], { root });
  if (!ready.ok) {
    for (const check of ready.failed) sayErr(styleText('red', `preflight: ${check.detail}\n  fix: ${check.fix}`, { stream: process.stderr }));
    if (jsonMode) emit({ ok: false, failed: ['preflight'], preflight: ready.checks });
    process.exit(3);
  }

  const initialGitStatus = await getGitStatus();

  // Phase 1: Clean & Sync
  say(styleText('blue', 'Phase 1: Syncing Content and Cleaning Caches...'));
  const clean = await runCommand('node', ['bin/clean-generated.ts']);
  if (clean.code !== 0) setupFailure('Cache Clean (bin/clean-generated.ts)', clean);
  const sync = await runCommand('node', ['bin/sync-content.ts'], { timeout: SYNC_TIMEOUT_MS });
  if (sync.code !== 0) setupFailure('Content Synchronization (sync:content)', sync);
  const postSyncGitStatus = await getGitStatus();
  if (postSyncGitStatus !== initialGitStatus) {
    const before = new Set(initialGitStatus.split('\n').filter(Boolean));
    const drift = postSyncGitStatus.split('\n').filter((line) => line && !before.has(line));
    say(styleText('yellow', `Vault drift detected: ${drift.length} synced path${drift.length === 1 ? '' : 's'} changed before validation.`));
    for (const line of drift) say(`  ${line}`);
    say('Review with `git diff -- src/content public/assets` or publish the synced snapshot.\n');
  } else {
    say('✓ Caches cleared & content synced.\n');
  }

  const checks: Check[] = [];

  // Phase 2: Pre-build audits (source + synced content; concurrent, printed in order)
  say(styleText('blue', 'Phase 2: Running Static Audits and Policy Checks...'));
  checks.push(...await runAudits(auditsFor('diagnose', 'pre-build'), { cwd: root, onResult: printResult }));
  say('');

  // Phase 3: the artifact the site ships and Playwright tests: build-static
  // (astro build + sitedrift wrap).
  if (runBuild) {
    say(styleText('blue', 'Phase 3: Compiling Production Build...'));
    const buildResult = await runCommand('node', ['bin/build-static.ts'], {
      env: browserTestEnv,
      timeout: 10 * 60_000,
    });
    const buildSuccess = buildResult.code === 0;
    say(`  ${buildSuccess ? styleText('green', '[PASS]') : styleText('red', '[FAIL]')} Static Site Build (${buildResult.duration}ms)\n`);
    checks.push({
      id: 'static-build', name: 'Production Static Build', skipped: false, ...buildResult,
      rerun: 'npm run build:static',
      fix: 'Fix HTML/CSS/JS compile errors during the static site building process.',
    });

    // Phase 4: Post-build audits + browser tests (only if the build compiled).
    // PREBUILT tells playwright.config.ts to reuse the Phase 3 artifact instead
    // of rebuilding it.
    if (buildSuccess) {
      say(styleText('blue', 'Phase 4: Running Post-Build Audits and Browser Tests...'));
      // The visual suite builds its own fixture tree, so it never takes PREBUILT.
      const postAudits = auditsFor('diagnose', 'post-build').filter((a) => runTests || !BROWSER_SUITES.has(a.id));
      checks.push(...await runAudits(postAudits, {
        cwd: root,
        optionsFor: postBuildOptions,
        onResult: printResult,
      }));
      say('');
    } else {
      say(styleText('yellow', 'Phase 4 Skipped: Static compilation failed.\n'));
    }
  } else {
    say(styleText('yellow', 'Phases 3 & 4 Skipped (--fast flag provided).\n'));
  }

  // Idempotence: tests/build must not mutate tracked or untracked state
  if (runBuild) {
    const finalGitStatus = await getGitStatus();
    const mutated = finalGitStatus !== initialGitStatus;
    checks.push({
      id: 'idempotence-check', name: 'Workspace Idempotence', skipped: false,
      code: mutated ? 1 : 0,
      stdout: mutated ? `Git status changed during run:\nBefore:\n${initialGitStatus}\nAfter:\n${finalGitStatus}` : 'Worktree is clean.',
      stderr: '', duration: 0,
      rerun: 'git status --porcelain=v1',
      fix: 'Running tests and builds mutated tracked files in the workspace. Commit synced content or reset generated files before pushing.',
    });
    say(`  ${!mutated ? styleText('green', '[PASS]') : styleText('red', '[FAIL]')} Worktree Idempotence Check\n`);
  }

  const failedChecks = checks.filter((c) => c.code !== 0 && !c.skipped);
  const totalSeconds = Math.round((Date.now() - startedAt) / 1000);

  if (failedChecks.length === 0) {
    const browserSkipped = checks.some((c) => c.id === 'browser-tests' && c.skipped);
    say(styleText(['bold', 'green'],
      browserSkipped
        ? `✓ ALL CHECKS PASSED in ${totalSeconds}s. Static checks and build are clean; browser/visual suite skipped (run on macOS before deploy).`
        : `✓ ALL CHECKS PASSED in ${totalSeconds}s. Codebase is logically clean and ready to deploy.`,
    ));
    if (fs.existsSync(reportPath)) fs.unlinkSync(reportPath);
    if (jsonMode) emitJson(checks, failedChecks);
    process.exit(0);
  }

  // Failures: write a structured Markdown report.
  sayErr(styleText(['bold', 'red'], `❌ ${failedChecks.length} CHECKS FAILED in ${totalSeconds}s.`, { stream: process.stderr }));
  say(`Writing diagnostic report to: ${styleText('bold', '.validation-report.md')}\n`);

  let markdown = `# Codebase Diagnostics & Issues Report\n\n`;
  markdown += `> [!IMPORTANT]\n`;
  markdown += `> This report lists all logical failures detected in the codebase by running deterministic test scripts. Fix these issues prior to pushing or deploying.\n\n`;
  markdown += `## Validation Summary\n\n`;
  markdown += `| Check Name | Status | Duration | Recommendation |\n`;
  markdown += `| :--- | :--- | :--- | :--- |\n`;

  for (const check of checks) {
    const status = check.skipped ? '⚠️ SKIP' : check.code !== 0 ? '❌ FAIL' : '✅ PASS';
    markdown += `| **${check.name}** | ${status} | ${check.duration}ms | ${check.fix ?? fixFor(check.id)} |\n`;
  }

  markdown += `\n---\n\n## Failure Details & Resolution Paths\n\n`;
  for (const check of failedChecks) {
    markdown += `### ❌ ${check.name} (\`${check.id}\`)\n\n`;
    markdown += `**Action Item**: ${check.fix ?? fixFor(check.id)}\n\n`;
    if (check.rerun) markdown += `**Rerun**: \`${check.rerun}\`\n\n`;
    markdown += `**Error Output**:\n\`\`\`text\n`;
    const combined = [check.stdout, check.stderr].map((s) => (s ?? '').trim()).filter(Boolean).join('\n');
    markdown += `${clipOutput(combined)}\n`;
    markdown += `\`\`\`\n\n`;
  }

  fs.writeFileSync(reportPath, markdown, 'utf8');
  if (jsonMode) emitJson(checks, failedChecks);
  process.exit(1);
}

diagnose().catch((err) => {
  console.error('Diagnostic harness error:', err);
  process.exit(1);
});
