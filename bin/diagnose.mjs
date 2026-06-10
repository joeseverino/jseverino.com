#!/usr/bin/env node
// The collect-all gate: run every check, then report everything that is wrong
// in one pass. Success prints one line; failure writes .validation-report.md
// with a clipped excerpt of each failure plus the exact command to rerun it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUDITS, auditsFor } from '../tests/audits/registry.mjs';
import { COLOR, run } from './lib/run.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = path.join(root, '.validation-report.md');

// Remediation text comes from the registry; orchestration-only checks (build,
// idempotence) carry their own `fix` on the result object.
const fixFor = (id) => AUDITS.find((a) => a.id === id)?.fix ?? 'Inspect error logs.';

// CLI options
const args = process.argv.slice(2);
const runTests = !args.includes('--fast') && !args.includes('--no-tests');
const runBuild = !args.includes('--fast');
const jsonMode = args.includes('--json');

// In --json mode the only stdout is the final JSON document.
const say = jsonMode ? () => {} : (text) => console.log(text);
const sayErr = jsonMode ? () => {} : (text) => console.error(text);

const runCommand = (cmd, cmdArgs, options = {}) => run(cmd, cmdArgs, { cwd: root, ...options });

async function getGitStatus() {
  const result = await runCommand('git', ['status', '--porcelain=v1']);
  return result.stdout.trim();
}

// The exact command to reproduce a registry audit outside the gate.
function rerunFor(audit) {
  const envPrefix = Object.entries(audit.exec.env ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
  return `${envPrefix} ${audit.exec.cmd} ${audit.exec.args.join(' ')}`.trim();
}

// Run a registry audit definition, normalizing to a result record.
async function runAudit(audit, extraEnv) {
  if (audit.macosOnly && process.platform !== 'darwin') {
    return { id: audit.id, name: audit.name, code: 0, stdout: '', stderr: `Skipped: ${audit.name} requires macOS.`, duration: 0, skipped: true, rerun: rerunFor(audit) };
  }
  if (audit.localOnly && process.env.CI) {
    return { id: audit.id, name: audit.name, code: 0, stdout: '', stderr: `Skipped: ${audit.name} verifies sources that only exist on the authoring machine.`, duration: 0, skipped: true, rerun: rerunFor(audit) };
  }
  const env = extraEnv ? { ...audit.exec.env, ...extraEnv } : audit.exec.env;
  const result = await runCommand(audit.exec.cmd, audit.exec.args, { env, timeout: audit.timeout });
  return { id: audit.id, name: audit.name, skipped: false, rerun: rerunFor(audit), ...result };
}

function printResult(res) {
  const statusText = res.skipped ? COLOR.yellow('[SKIP]') : res.code === 0 ? COLOR.green('[PASS]') : COLOR.red('[FAIL]');
  say(`  ${statusText.padEnd(15)} ${res.name} (${res.duration}ms)`);
}

// Run audits concurrently (capped) but print results in registry order, each
// as soon as it and everything before it has finished.
async function runAuditsOrdered(audits, limit = 4) {
  const results = new Array(audits.length);
  let nextIndex = 0;
  let printedThrough = 0;
  const flush = () => {
    while (printedThrough < audits.length && results[printedThrough] !== undefined) {
      printResult(results[printedThrough]);
      printedThrough += 1;
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, audits.length) }, async () => {
      while (nextIndex < audits.length) {
        const index = nextIndex++;
        results[index] = await runAudit(audits[index]);
        flush();
      }
    }),
  );
  return results;
}

// Keep the report reviewable when a check (Playwright especially) dumps
// thousands of lines: keep the head and tail, point at the rerun command.
function clipOutput(text, head = 20, tail = 60) {
  const lines = text.trim().split('\n');
  if (lines.length <= head + tail + 1) return text.trim();
  return [
    ...lines.slice(0, head),
    `… ${lines.length - head - tail} lines elided — use the rerun command above for full output …`,
    ...lines.slice(-tail),
  ].join('\n');
}

function emitJson(checks, failedChecks) {
  console.log(JSON.stringify({
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
  }, null, 2));
}

function setupFailure(name, result) {
  sayErr(COLOR.red(`❌ Setup failed: ${name} exited with code ${result.code}`));
  const errorOutput = (result.stderr || result.stdout || '').trim();
  sayErr(errorOutput);

  let markdown = `# Codebase Diagnostics & Issues Report\n\n`;
  markdown += `> [!CAUTION]\n`;
  markdown += `> ${name} failed. The verification pipeline cannot proceed.\n\n`;
  markdown += `### ❌ ${name}\n\n`;
  markdown += `**Error Output**:\n\`\`\`text\n${clipOutput(errorOutput)}\n\`\`\`\n`;
  fs.writeFileSync(reportPath, markdown, 'utf8');
  if (jsonMode) {
    console.log(JSON.stringify({ ok: false, failed: ['setup'], report: path.relative(root, reportPath), setup: name }, null, 2));
  }
  process.exit(1);
}

async function diagnose() {
  const startedAt = Date.now();
  say(COLOR.bold('Starting Deterministic E2E Codebase Diagnosis...\n'));

  const initialGitStatus = await getGitStatus();

  // Phase 1: Clean & Sync
  say(COLOR.blue('Phase 1: Syncing Content and Cleaning Caches...'));
  const cleanAll = await runCommand('node', ['bin/clean-generated.mjs', '--all']);
  if (cleanAll.code !== 0) setupFailure('Cache Clean (bin/clean-generated.mjs --all)', cleanAll);
  const sync = await runCommand('node', ['bin/sync-content.mjs']);
  if (sync.code !== 0) setupFailure('Content Synchronization (sync:content)', sync);
  const cleanConflicts = await runCommand('node', ['bin/clean-generated.mjs', '--conflicts']);
  if (cleanConflicts.code !== 0) setupFailure('Conflict Cleanup (bin/clean-generated.mjs)', cleanConflicts);
  say('✓ Caches cleared & content synced.\n');

  const checks = [];

  // Phase 2: Pre-build audits (source + synced content; concurrent, printed in order)
  say(COLOR.blue('Phase 2: Running Static Audits and Policy Checks...'));
  checks.push(...await runAuditsOrdered(auditsFor('diagnose', 'pre-build')));
  say('');

  // Phase 3: the same build artifact the site ships and Playwright tests —
  // build-static (astro build + sitedrift wrap), not a bare astro build.
  if (runBuild) {
    say(COLOR.blue('Phase 3: Compiling Production Build...'));
    const buildResult = await runCommand('node', ['bin/build-static.mjs'], { timeout: 10 * 60_000 });
    const buildSuccess = buildResult.code === 0;
    say(`  ${(buildSuccess ? COLOR.green('[PASS]') : COLOR.red('[FAIL]')).padEnd(15)} Static Site Build (${buildResult.duration}ms)\n`);
    checks.push({
      id: 'static-build', name: 'Production Static Build', skipped: false, ...buildResult,
      rerun: 'npm run build:static',
      fix: 'Fix HTML/CSS/JS compile errors during the static site building process.',
    });

    // Phase 4: Post-build audits + browser tests (only if the build compiled).
    // PREBUILT tells playwright.config.ts to reuse the Phase 3 artifact instead
    // of rebuilding it.
    if (buildSuccess) {
      say(COLOR.blue('Phase 4: Running Post-Build Audits and Browser Tests...'));
      const postAudits = auditsFor('diagnose', 'post-build').filter((a) => runTests || a.id !== 'browser-tests');
      const postResults = await Promise.all(
        postAudits.map((audit) => runAudit(audit, audit.id === 'browser-tests' ? { PREBUILT: '1' } : undefined)),
      );
      checks.push(...postResults);
      postResults.forEach(printResult);
      say('');
    } else {
      say(COLOR.yellow('Phase 4 Skipped: Static compilation failed.\n'));
    }
  } else {
    say(COLOR.yellow('Phases 3 & 4 Skipped (--fast flag provided).\n'));
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
    say(`  ${(!mutated ? COLOR.green('[PASS]') : COLOR.red('[FAIL]')).padEnd(15)} Worktree Idempotence Check\n`);
  }

  // Compile final results
  const failedChecks = checks.filter((c) => c.code !== 0 && !c.skipped);
  const totalSeconds = Math.round((Date.now() - startedAt) / 1000);

  if (failedChecks.length === 0) {
    const browserSkipped = checks.some((c) => c.id === 'browser-tests' && c.skipped);
    say(COLOR.bold(COLOR.green(
      browserSkipped
        ? `✓ ALL CHECKS PASSED in ${totalSeconds}s. Static checks and build are clean; browser/visual suite skipped (run on macOS before deploy).`
        : `✓ ALL CHECKS PASSED in ${totalSeconds}s. Codebase is logically clean and ready to deploy.`,
    )));
    if (fs.existsSync(reportPath)) fs.unlinkSync(reportPath);
    if (jsonMode) emitJson(checks, failedChecks);
    process.exit(0);
  }

  // Failures: write a structured Markdown report.
  sayErr(COLOR.bold(COLOR.red(`❌ ${failedChecks.length} CHECKS FAILED in ${totalSeconds}s.`)));
  say(`Writing diagnostic report to: ${COLOR.bold('.validation-report.md')}\n`);

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
