#!/usr/bin/env node
import path from 'node:path';
import { auditsFor } from '../tests/audits/registry.mjs';
import { firstFailureLine, summarize } from './lib/audit-summary.mjs';
import { run as spawnRun, status as printStatus } from './lib/run.mjs';
import { annotate, appendSummary, outcome, table } from './lib/step-summary.mjs';
import { siteRoot } from '../src/lib/site-root.mjs';

// --no-sync runs every gate EXCEPT the vault sync, so a code/refactor change can
// be verified without sync-content rewriting src/content from the vault (which
// could drag in unrelated vault drift). Use it when you haven't touched content.
const noSync = process.argv.includes('--no-sync');
const node = process.execPath;
const astro = path.join(siteRoot, 'node_modules/.bin/astro');

// Every status line also becomes a row of the job summary in CI.
const rows = [];

function status(label, detail) {
  rows.push([label, true, detail]);
  printStatus(label, detail);
}

function writeSummary() {
  const failed = rows.filter(([, ok]) => ok === false).length;
  appendSummary([
    '## Publish gate',
    '',
    failed === 0 ? `All ${rows.length} steps passed.` : `Stopped at the first failure after ${rows.length} steps.`,
    '',
    table(['Step', 'Result', 'Detail'], rows.map(([label, ok, detail]) => [`\`${label}\``, outcome(ok), detail])),
  ].join('\n'));
}

// Fail-fast wrapper: this gate stops at the first broken check.
async function run(label, command, args, options = {}) {
  const result = await spawnRun(command, args, {
    cwd: siteRoot,
    env: options.env,
    timeout: options.timeout,
  });

  if (result.code !== 0) {
    const reason = firstFailureLine(result.output);
    rows.push([label, false, reason]);
    annotate('error', `publish-check: ${label}`, reason);
    writeSummary();
    console.error(`\nfailed: ${label}`);
    if (result.stdout.trim()) console.error(`\nstdout:\n${result.stdout.trimEnd()}`);
    if (result.stderr.trim()) console.error(`\nstderr:\n${result.stderr.trimEnd()}`);
    process.exit(result.code);
  }

  return result;
}

async function runAudit(audit) {
  if (audit.localOnly && process.env.CI) {
    status(audit.label, 'skipped (verifies sources that only exist on the authoring machine)');
    return;
  }
  const { output } = await run(audit.label, audit.exec.cmd, audit.exec.args, {
    env: audit.exec.env,
    timeout: audit.timeout,
  });
  status(audit.label, summarize(audit, output));
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

async function summarizeContentChanges() {
  const statusResult = await run(
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

// 1. Clean caches and resolve any iCloud conflict copies.
const cleanGenerated = await run('clean generated output', node, ['bin/clean-generated.mjs', '--all']);
for (const line of cleanGenerated.output.split('\n')) {
  if (/Removed .*conflict copy|Resolved \d+ iCloud conflict/.test(line)) status('clean', line.trim());
}

// 2. Sync the public content snapshot from the vault (unless --no-sync).
if (noSync) {
  status('sync', 'skipped (--no-sync)');
} else {
  await run('sync content', node, ['bin/sync-content.mjs']);
  status('sync', 'content snapshot updated');
}
await run('clean conflict copies', node, ['bin/clean-generated.mjs', '--conflicts']);
await summarizeContentChanges();

// 3. Pre-build audits (source + synced content). astro-check needs the sync,
//    so all pre-build audits run after it.
for (const audit of auditsFor('publish', 'pre-build')) await runAudit(audit);

// 4. Production build.
const build = await run('astro build', astro, ['build'], {
  env: { ASTRO_TELEMETRY_DISABLED: '1' },
  timeout: 10 * 60_000,
});
const pageCount = build.output.match(/\[build\] (\d+) page\(s\) built/);
status('build', pageCount ? `${pageCount[1]} pages built` : 'completed');
await run('clean conflict copies', node, ['bin/clean-generated.mjs', '--conflicts']);

// 5. Post-build audits (operate on the emitted dist/).
for (const audit of auditsFor('publish', 'post-build')) await runAudit(audit);

writeSummary();
