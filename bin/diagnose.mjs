#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUDITS, auditsFor } from '../tests/audits/registry.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = path.join(root, '.validation-report.md');

// Remediation text comes from the registry; orchestration-only checks (build,
// idempotence) carry their own `fix` on the result object.
const fixFor = (id) => AUDITS.find((a) => a.id === id)?.fix ?? 'Inspect error logs.';

// CLI options
const args = process.argv.slice(2);
const runTests = !args.includes('--fast') && !args.includes('--no-tests');
const runBuild = !args.includes('--fast');

const COLOR = {
  green: (text) => `\x1b[32m${text}\x1b[0m`,
  red: (text) => `\x1b[31m${text}\x1b[0m`,
  yellow: (text) => `\x1b[33m${text}\x1b[0m`,
  blue: (text) => `\x1b[34m${text}\x1b[0m`,
  bold: (text) => `\x1b[1m${text}\x1b[0m`,
};

function runCommand(cmd, cmdArgs, options = {}) {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn(cmd, cmdArgs, {
      cwd: root,
      env: { ...process.env, ...options.env },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      resolve({ code, stdout, stderr, duration: Date.now() - start });
    });
  });
}

function getGitStatus() {
  const child = spawn('git', ['status', '--porcelain=v1'], { cwd: root });
  return new Promise((resolve) => {
    let output = '';
    child.stdout.on('data', (data) => { output += data.toString(); });
    child.on('close', () => resolve(output.trim()));
  });
}

// Run a registry audit definition, normalizing to a result record.
async function runAudit(audit) {
  if (audit.macosOnly && process.platform !== 'darwin') {
    return { id: audit.id, name: audit.name, code: 0, stdout: '', stderr: `Skipped: ${audit.name} requires macOS.`, duration: 0, skipped: true };
  }
  const result = await runCommand(audit.exec.cmd, audit.exec.args, { env: audit.exec.env });
  return { id: audit.id, name: audit.name, skipped: false, ...result };
}

function printResult(res) {
  const statusText = res.skipped ? COLOR.yellow('[SKIP]') : res.code === 0 ? COLOR.green('[PASS]') : COLOR.red('[FAIL]');
  console.log(`  ${statusText.padEnd(15)} ${res.name} (${res.duration}ms)`);
}

async function diagnose() {
  console.log(COLOR.bold('Starting Deterministic E2E Codebase Diagnosis...\n'));

  const initialGitStatus = await getGitStatus();

  // Phase 1: Clean & Sync
  console.log(COLOR.blue('Phase 1: Syncing Content and Cleaning Caches...'));
  const cleanAll = await runCommand('node', ['bin/clean-generated.mjs', '--all']);
  if (cleanAll.code !== 0) {
    console.error(COLOR.red(`❌ Setup failed: bin/clean-generated.mjs --all exited with code ${cleanAll.code}`));
    console.error(cleanAll.stderr || cleanAll.stdout);
    process.exit(1);
  }
  const sync = await runCommand('node', ['bin/sync-content.mjs']);
  if (sync.code !== 0) {
    console.error(COLOR.red(`❌ Setup failed: bin/sync-content.mjs exited with code ${sync.code}`));
    const errorOutput = (sync.stderr || sync.stdout || '').trim();
    console.error(errorOutput);

    let markdown = `# Codebase Diagnostics & Issues Report\n\n`;
    markdown += `> [!CAUTION]\n`;
    markdown += `> Content Synchronization (sync:content) failed. The verification pipeline cannot proceed without a valid content sync.\n\n`;
    markdown += `### ❌ Content Sync Failure\n\n`;
    markdown += `**Error Output**:\n\`\`\`text\n${errorOutput}\n\`\`\`\n`;
    fs.writeFileSync(reportPath, markdown, 'utf8');
    process.exit(1);
  }
  const cleanConflicts = await runCommand('node', ['bin/clean-generated.mjs']);
  if (cleanConflicts.code !== 0) {
    console.error(COLOR.red(`❌ Setup failed: bin/clean-generated.mjs exited with code ${cleanConflicts.code}`));
    console.error(cleanConflicts.stderr || cleanConflicts.stdout);
    process.exit(1);
  }
  console.log('✓ Caches cleared & content synced.\n');

  const checks = [];

  // Phase 2: Pre-build audits (source + synced content; serial for readable output)
  console.log(COLOR.blue('Phase 2: Running Static Audits and Policy Checks...'));
  for (const audit of auditsFor('diagnose', 'pre-build')) {
    const res = await runAudit(audit);
    checks.push(res);
    printResult(res);
  }
  console.log('');

  // Phase 3: Astro Build
  if (runBuild) {
    console.log(COLOR.blue('Phase 3: Compiling Production Build...'));
    const buildResult = await runCommand('npx', ['astro', 'build'], { env: { ASTRO_TELEMETRY_DISABLED: '1' } });
    const buildSuccess = buildResult.code === 0;
    console.log(`  ${(buildSuccess ? COLOR.green('[PASS]') : COLOR.red('[FAIL]')).padEnd(15)} Static Site Build (${buildResult.duration}ms)\n`);
    checks.push({
      id: 'astro-build', name: 'Production Static Build', skipped: false, ...buildResult,
      fix: 'Fix HTML/CSS/JS compile errors during the static site building process.',
    });

    // Phase 4: Post-build audits + browser tests (only if the build compiled)
    if (buildSuccess) {
      console.log(COLOR.blue('Phase 4: Running Post-Build Audits and Browser Tests...'));
      const postAudits = auditsFor('diagnose', 'post-build').filter((a) => runTests || a.id !== 'browser-tests');
      const postResults = await Promise.all(postAudits.map(runAudit));
      checks.push(...postResults);
      postResults.forEach(printResult);
      console.log('');
    } else {
      console.log(COLOR.yellow('Phase 4 Skipped: Static compilation failed.\n'));
    }
  } else {
    console.log(COLOR.yellow('Phases 3 & 4 Skipped (--fast flag provided).\n'));
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
      fix: 'Running tests and builds mutated tracked files in the workspace. Commit synced content or reset generated files before pushing.',
    });
    console.log(`  ${(!mutated ? COLOR.green('[PASS]') : COLOR.red('[FAIL]')).padEnd(15)} Worktree Idempotence Check\n`);
  }

  // Compile final results
  const failedChecks = checks.filter((c) => c.code !== 0 && !c.skipped);

  if (failedChecks.length === 0) {
    const browserSkipped = checks.some((c) => c.id === 'browser-tests' && c.skipped);
    console.log(COLOR.bold(COLOR.green(
      browserSkipped
        ? '✓ ALL CHECKS PASSED. Static checks and build are clean; browser/visual suite skipped (run on macOS before deploy).'
        : '✓ ALL CHECKS PASSED. Codebase is logically clean and ready to deploy.',
    )));
    if (fs.existsSync(reportPath)) fs.unlinkSync(reportPath);
    process.exit(0);
  }

  // Failures: write a structured Markdown report.
  console.error(COLOR.bold(COLOR.red(`❌ ${failedChecks.length} CHECKS FAILED.`)));
  console.log(`Writing diagnostic report to: ${COLOR.bold('.validation-report.md')}\n`);

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
    markdown += `**Error Output**:\n\`\`\`text\n`;
    if (check.stdout && check.stdout.trim()) markdown += `${check.stdout.trim()}\n`;
    if (check.stderr && check.stderr.trim()) markdown += `${check.stderr.trim()}\n`;
    markdown += `\`\`\`\n\n`;
  }

  fs.writeFileSync(reportPath, markdown, 'utf8');
  process.exit(1);
}

diagnose().catch((err) => {
  console.error('Diagnostic harness error:', err);
  process.exit(1);
});
