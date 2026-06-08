#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const node = process.execPath;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const astro = path.join(siteRoot, 'node_modules/.bin/astro');

function stripAnsi(value) {
  return value.replace(/\x1b\[[0-9;]*m/g, '');
}

function run(label, command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: siteRoot,
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: 'utf8',
  });

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';

  if (result.status !== 0) {
    console.error(`\nfailed: ${label}`);
    if (stdout.trim()) console.error(`\nstdout:\n${stdout.trimEnd()}`);
    if (stderr.trim()) console.error(`\nstderr:\n${stderr.trimEnd()}`);
    process.exit(result.status ?? 1);
  }

  return { stdout, stderr, output: stripAnsi(`${stdout}\n${stderr}`) };
}

function status(label, detail) {
  console.log(`${label.padEnd(10)} ${detail}`);
}

function contentSlug(file) {
  const normalized = file.replace(/\\/g, '/').replace(/\/$/, '');

  let match = normalized.match(/^src\/content\/writeups\/([^/]+)(?:\/|$)/);
  if (match) return match[1];

  match = normalized.match(/^src\/content\/pages\/([^/]+)\.md$/);
  if (match) return match[1];

  match = normalized.match(/^src\/content\/([^/]+)\.md$/);
  if (match) return match[1];

  match = normalized.match(/^public\/assets\/writeups\/([^/]+)(?:\/|$)/);
  if (match) return match[1];

  match = normalized.match(/^public\/assets\/pages\/([^/]+)(?:\/|$)/);
  if (match) return match[1];

  return undefined;
}

function contentChangeKind(file, rawStatus) {
  const normalized = file.replace(/\\/g, '/');
  const isContentIndex =
    /^src\/content\/writeups\/[^/]+(?:\/index\.md|\/?)$/.test(normalized) ||
    /^src\/content\/pages\/[^/]+\.md$/.test(normalized) ||
    /^src\/content\/[^/]+\.md$/.test(normalized);

  if (!isContentIndex) return 'edited';
  if (rawStatus.includes('D')) return 'removed';
  if (rawStatus.includes('A') || rawStatus === '??') return 'added';
  return 'edited';
}

function summarizeContentChanges() {
  const statusResult = run(
    'inspect content diff',
    'git',
    ['status', '--porcelain=v1', '--', 'src/content', 'public/assets'],
  );

  const changes = new Map();
  const priority = { edited: 1, added: 2, removed: 2 };

  for (const line of statusResult.output.split('\n')) {
    if (!line.trim()) continue;

    const rawStatus = line.slice(0, 2);
    const rawPath = line.slice(3);
    const file = rawPath.includes(' -> ') ? rawPath.split(' -> ').at(-1) : rawPath;
    const slug = contentSlug(file);
    if (!slug) continue;

    const kind = contentChangeKind(file, rawStatus);
    const existing = changes.get(slug);
    if (!existing || priority[kind] >= priority[existing]) changes.set(slug, kind);
  }

  const grouped = { added: [], edited: [], removed: [] };
  for (const [slug, kind] of changes) grouped[kind].push(slug);
  for (const slugs of Object.values(grouped)) slugs.sort();

  const summary = Object.entries(grouped)
    .filter(([, slugs]) => slugs.length > 0)
    .map(([kind, slugs]) => `${kind} ${slugs.length}: ${slugs.join(', ')}`)
    .join('; ');

  status('content', summary || 'no content changes');
}

const security = run('security.txt', node, ['bin/security-txt.mjs', 'check']);
const securityLine = security.output.split('\n').find((line) => line.startsWith('ok'));
status('security', securityLine ? securityLine.replace(/^ok\s+/, '').trim() : 'passed');

const contrast = run('contrast pairs', node, ['bin/check-contrast.mjs']);
const contrastLine = contrast.output.split('\n').find((line) => line.startsWith('ok       '));
status('contrast', contrastLine ? contrastLine.replace(/^ok\s+/, '').trim() : 'passed');

const parity = run('vault/MCP parity', node, ['bin/check-vault-mcp-parity.mjs']);
const parityLine = parity.output.split('\n').find((line) => line.startsWith('ok'));
status('parity', parityLine ? parityLine.replace(/^ok\s+/, '').trim() : 'passed');

const preview = run('sitedrift preview guard', node, ['bin/check-sitedrift-preview.mjs']);
const previewLine = preview.output.split('\n').find((line) => line.startsWith('ok'));
status('preview', previewLine ? previewLine.replace(/^ok\s+/, '').trim() : 'passed');

const cleanGenerated = run('clean generated output', node, ['bin/clean-generated.mjs', '--all']);
for (const line of cleanGenerated.output.split('\n')) {
  if (/Removed .*conflict copy|Resolved \d+ iCloud conflict/.test(line)) {
    status('clean', line.trim());
  }
}

run('sync content', node, ['bin/sync-content.mjs']);
status('sync', 'content snapshot updated');

run('clean conflict copies', node, ['bin/clean-generated.mjs']);
summarizeContentChanges();

run('CSS lint', npm, ['run', '-s', 'lint:css']);
run('CSS custom property audit', npm, ['run', '-s', 'audit:css']);
status('css', 'lint and custom property audit passed');

const check = run(
  'astro check',
  astro,
  ['check', '--minimumSeverity', 'warning'],
  {
    env: {
      ASTRO_TELEMETRY_DISABLED: '1',
      NODE_OPTIONS: '--max-old-space-size=4096',
    },
  },
);

const checkResult = check.output.match(/Result \([^)]+\):\s*\n- 0 errors\s*\n- 0 warnings/);
status('check', checkResult ? '0 errors, 0 warnings' : 'passed');

const build = run('astro build', astro, ['build'], {
  env: { ASTRO_TELEMETRY_DISABLED: '1' },
});

const pageCount = build.output.match(/\[build\] (\d+) page\(s\) built/);
status('build', pageCount ? `${pageCount[1]} pages built` : 'completed');

run('clean conflict copies', node, ['bin/clean-generated.mjs']);

const audit = run('audit assets', node, ['bin/audit-assets.mjs']);
const auditLines = audit.output
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);
const imageCount = auditLines.find((line) => line.startsWith('Images:'));
const totalWeight = auditLines.find((line) => line.startsWith('Total image weight:'));
const oversized = auditLines.find((line) => line.startsWith('No images over'));
status(
  'assets',
  [imageCount, totalWeight, oversized]
    .filter(Boolean)
    .join('; '),
);
