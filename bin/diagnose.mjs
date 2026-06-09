#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = path.join(root, '.validation-report.md');

// CLI options
const args = process.argv.slice(2);
const runAll = !args.includes('--fast') && !args.includes('--no-tests');
const runTests = runAll && !args.includes('--no-tests');
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
      resolve({
        code,
        stdout,
        stderr,
        duration: Date.now() - start,
      });
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

const TROUBLESHOOTING = {
  'security-check': {
    title: 'Security Signature Verification',
    action: 'Run `npm run sign:security` to sign or re-sign `public/.well-known/security.txt` with the security@ key.',
  },
  'contrast-check': {
    title: 'Color Contrast Audit',
    action: 'Adjust colors in `src/styles/base.css` to achieve >= 4.5:1 ratio, or register the custom pair in `tests/audits/check-contrast.mjs`.',
  },
  'parity-check': {
    title: 'Vault/MCP/Astro Parity',
    action: 'Ensure the vault frontmatter schema (`Frontmatter Schema.md`), Zod schema (`src/content.config.ts`), and the Python MCP server parameters agree on all fields.',
  },
  'preview-check': {
    title: 'SiteDrift Preview Safety',
    action: 'Check `tests/audits/check-sitedrift-preview.mjs`. SiteDrift proxy wrapping must be active on feature branches and absent on main.',
  },
  'repo-policy': {
    title: 'Repository Policy Enforcement',
    action: 'Align Node version (.nvmrc), lockfile dependencies, commit hashes for GitHub Actions, or run `npm run clean:conflicts` to remove iCloud conflict copies.',
  },
  'docs-check': {
    title: 'Documentation Integrity',
    action: 'A doc links to a renamed/removed file or an npm script that no longer exists. Fix the reference at the reported file:line, or restore the target.',
  },
  'css-lint': {
    title: 'Stylelint Audit',
    action: 'Fix syntax and rule violations in your CSS files located under `src/styles/`.',
  },
  'css-check': {
    title: 'Unused CSS variables',
    action: 'Remove declared CSS custom properties in `src/styles/` that are never referenced with `var(...)`.',
  },
  'astro-check': {
    title: 'Astro Type & Content Check',
    action: 'Run `npx astro check` to debug TypeScript typing issues, content schemas, or file imports.',
  },
  'astro-build': {
    title: 'Astro Production Build',
    action: 'Fix HTML/CSS/JS compile errors during the static site building process.',
  },
  'asset-audit': {
    title: 'Asset Size Check',
    action: 'Optimize images in `public/assets/` to ensure none exceed 1.5MB. Set `STRICT_ASSET_AUDIT=0` if override is necessary.',
  },
  'seo-check': {
    title: 'SEO Metadata',
    action: 'A built page is missing a `<title>`, canonical link, og:title/og:image, or has invalid JSON-LD. Check `src/components/SeoHead.astro` and the page frontmatter.',
  },
  'browser-tests': {
    title: 'Playwright E2E & Visuals',
    action: 'Run `npx playwright test --ui` to debug functional test specs locally. If a layout change was intentional, update baseline screenshots with `npm run test:e2e:visual:update`.',
  },
  'git-diff-check': {
    title: 'Git Diff Standards',
    action: 'Fix trailing whitespace, missing end-of-lines, or unresolved git conflict markers reported by `git diff --check`.',
  },
  'idempotence-check': {
    title: 'Build Idempotence Check',
    action: 'Running tests and builds mutated tracked files in the workspace. Commit synced content or reset generated files before pushing.',
  },
};

async function diagnose() {
  console.log(COLOR.bold('Starting Deterministic E2E Codebase Diagnosis...\n'));

  // Record initial git status to check for idempotence
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
    
    // Write setup failure to report
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

  // Define checks
  const checks = [];

  // Phase 2: Static Verification (can run in parallel!)
  console.log(COLOR.blue('Phase 2: Running Static Audits and Policy Checks...'));

  const staticTests = [
    { id: 'security-check', name: 'Security Signatures', cmd: 'node', args: ['tests/audits/check-security-txt.mjs'] },
    { id: 'contrast-check', name: 'WCAG Color Contrast', cmd: 'node', args: ['tests/audits/check-contrast.mjs'] },
    { id: 'parity-check', name: 'Vault/MCP/Code Parity', cmd: 'node', args: ['tests/audits/check-vault-mcp-parity.mjs'] },
    { id: 'preview-check', name: 'Sitedrift Preview Guard', cmd: 'node', args: ['tests/audits/check-sitedrift-preview.mjs'] },
    { id: 'repo-policy', name: 'Repository Policy', cmd: 'node', args: ['tests/audits/check-repository-policy.mjs'] },
    { id: 'docs-check', name: 'Docs Link Integrity', cmd: 'node', args: ['tests/audits/check-docs.mjs'] },
    { id: 'css-lint', name: 'Stylelint CSS Check', cmd: 'npx', args: ['stylelint', 'src/styles/**/*.css'] },
    { id: 'css-check', name: 'CSS Unused Variables', cmd: 'node', args: ['tests/audits/check-css.mjs'] },
    { id: 'astro-check', name: 'Astro Compiler Diagnostics', cmd: 'npx', args: ['astro', 'check', '--minimumSeverity', 'warning'], env: { ASTRO_TELEMETRY_DISABLED: '1', NODE_OPTIONS: '--max-old-space-size=4096' } },
    { id: 'git-diff-check', name: 'Git Formatting/Conflicts', cmd: 'git', args: ['diff', '--check'] },
  ];

  const staticResults = [];
  for (const test of staticTests) {
    const result = await runCommand(test.cmd, test.args, { env: test.env });
    staticResults.push({ ...test, ...result });
  }

  checks.push(...staticResults);

  // Print results of Phase 2
  for (const res of staticResults) {
    const statusText = res.code === 0 ? COLOR.green('[PASS]') : COLOR.red('[FAIL]');
    console.log(`  ${statusText.padEnd(15)} ${res.name} (${res.duration}ms)`);
  }
  console.log('');

  // Phase 3: Astro Build
  if (runBuild) {
    console.log(COLOR.blue('Phase 3: Compiling Production Build...'));
    const buildResult = await runCommand('npx', ['astro', 'build'], { env: { ASTRO_TELEMETRY_DISABLED: '1' } });
    const buildSuccess = buildResult.code === 0;
    const statusText = buildSuccess ? COLOR.green('[PASS]') : COLOR.red('[FAIL]');
    console.log(`  ${statusText.padEnd(15)} Static Site Build (${buildResult.duration}ms)\n`);

    checks.push({
      id: 'astro-build',
      name: 'Production Static Build',
      code: buildResult.code,
      stdout: buildResult.stdout,
      stderr: buildResult.stderr,
      duration: buildResult.duration,
    });

    // Phase 4: Post-Build and Functional E2E (only runs if build succeeded)
    if (buildSuccess) {
      console.log(COLOR.blue('Phase 4: Running Post-Build Audits and Browser Tests...'));

      const postBuildTests = [
        {
          id: 'asset-audit',
          name: 'Asset Weight Limits',
          cmd: 'node',
          args: ['tests/audits/audit-assets.mjs'],
          env: { STRICT_ASSET_AUDIT: '1' },
        },
        {
          id: 'seo-check',
          name: 'SEO Metadata',
          cmd: 'node',
          args: ['tests/audits/check-seo.mjs'],
        },
      ];

      if (runTests) {
        if (process.platform !== 'darwin') {
          console.log(COLOR.yellow('  [SKIP]          Playwright Browser Tests (requires macOS due to visual baselines)'));
          checks.push({
            id: 'browser-tests',
            name: 'Playwright Browser Tests',
            code: 0,
            stdout: '',
            stderr: 'Skipped: Not on macOS.',
            duration: 0,
            skipped: true,
          });
        } else {
          postBuildTests.push({
            id: 'browser-tests',
            name: 'Playwright Browser Tests',
            cmd: 'npx',
            args: ['playwright', 'test', '--reporter=line'],
            env: { CI: '1', ASTRO_TELEMETRY_DISABLED: '1', VISUAL: '1' },
          });
        }
      }

      const postResults = await Promise.all(
        postBuildTests.map(async (test) => {
          const result = await runCommand(test.cmd, test.args, { env: test.env });
          return { ...test, ...result };
        }),
      );

      checks.push(...postResults);

      for (const res of postResults) {
        const statusText = res.code === 0 ? COLOR.green('[PASS]') : COLOR.red('[FAIL]');
        console.log(`  ${statusText.padEnd(15)} ${res.name} (${res.duration}ms)`);
      }
      console.log('');
    } else {
      console.log(COLOR.yellow('Phase 4 Skipped: Static compilation failed.\n'));
    }
  } else {
    console.log(COLOR.yellow('Phases 3 & 4 Skipped (--fast flag provided).\n'));
  }

  // Idempotence check (Git status unchanged)
  if (runBuild) {
    const finalGitStatus = await getGitStatus();
    const mutated = finalGitStatus !== initialGitStatus;
    checks.push({
      id: 'idempotence-check',
      name: 'Workspace Idempotence',
      code: mutated ? 1 : 0,
      stdout: mutated ? `Git status changed during run:\nBefore:\n${initialGitStatus}\nAfter:\n${finalGitStatus}` : 'Worktree is clean.',
      stderr: '',
      duration: 0,
    });
    const statusText = !mutated ? COLOR.green('[PASS]') : COLOR.red('[FAIL]');
    console.log(`  ${statusText.padEnd(15)} Worktree Idempotence Check`);
    console.log('');
  }

  // Compile final results
  const failedChecks = checks.filter((c) => c.code !== 0 && !c.skipped);
  const success = failedChecks.length === 0;

  if (success) {
    const browserSkipped = checks.some((c) => c.id === 'browser-tests' && c.skipped);
    const message = browserSkipped
      ? '✓ ALL CHECKS PASSED. Static checks and build are clean; browser/visual suite skipped (run on macOS before deploy).'
      : '✓ ALL CHECKS PASSED. Codebase is logically clean and ready to deploy.';
    console.log(COLOR.bold(COLOR.green(message)));
    // Clean up any stale validation report
    if (fs.existsSync(reportPath)) fs.unlinkSync(reportPath);
    process.exit(0);
  }

  // There are failures! Write a highly structured Markdown report.
  console.error(COLOR.bold(COLOR.red(`❌ ${failedChecks.length} CHECKS FAILED.`)));
  console.log(`Writing diagnostic report to: ${COLOR.bold('.validation-report.md')}\n`);

  let markdown = `# Codebase Diagnostics & Issues Report\n\n`;
  markdown += `> [!IMPORTANT]\n`;
  markdown += `> This report lists all logical failures detected in the codebase by running deterministic test scripts. Fix these issues prior to pushing or deploying.\n\n`;

  markdown += `## Validation Summary\n\n`;
  markdown += `| Check Name | Status | Duration | Recommendation |\n`;
  markdown += `| :--- | :--- | :--- | :--- |\n`;

  for (const check of checks) {
    let status = '✅ PASS';
    if (check.skipped) status = '⚠️ SKIP';
    else if (check.code !== 0) status = '❌ FAIL';

    const t = TROUBLESHOOTING[check.id] || { action: 'Inspect error logs.' };
    markdown += `| **${check.name}** | ${status} | ${check.duration}ms | ${t.action} |\n`;
  }

  markdown += `\n---\n\n## Failure Details & Resolution Paths\n\n`;

  for (const check of failedChecks) {
    const t = TROUBLESHOOTING[check.id] || { title: check.name, action: 'Inspect logs.' };
    markdown += `### ❌ ${t.title} (\`${check.id}\`)\n\n`;
    markdown += `**Action Item**: ${t.action}\n\n`;
    markdown += `**Error Output**:\n`;
    markdown += `\`\`\`text\n`;
    if (check.stdout && check.stdout.trim()) {
      markdown += `${check.stdout.trim()}\n`;
    }
    if (check.stderr && check.stderr.trim()) {
      markdown += `${check.stderr.trim()}\n`;
    }
    markdown += `\`\`\`\n\n`;
  }

  fs.writeFileSync(reportPath, markdown, 'utf8');
  process.exit(1);
}

diagnose().catch((err) => {
  console.error('Diagnostic harness error:', err);
  process.exit(1);
});
