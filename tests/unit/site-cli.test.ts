import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { siteRoot } from '../../src/lib/site-root.ts';
import type { SiteFailure, SiteHelp } from '../../bin/site/types.ts';

const site = (...args: string[]) => {
  const result = spawnSync(process.execPath, ['bin/site.ts', ...args], { cwd: siteRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

test('<command> --help --json prints the usage as one JSON document', () => {
  for (const args of [['publish', '--help', '--json'], ['publish', '--json', '--help'], ['help', 'publish', '--json']]) {
    const result = site(...args);
    assert.equal(result.status, 0, result.stderr);
    const doc = JSON.parse(result.stdout) as SiteHelp;
    assert.equal(doc.command, 'publish');
    assert.equal(doc.status, 'help');
    assert.match(doc.usage, /^site publish/);
    assert.ok(doc.options.some((option) => option.name === 'dry-run' && option.type === 'boolean'), args.join(' '));
    assert.deepEqual(doc.exitCodes, { ok: 0, failed: 1, usage: 2, preflight: 3, timeout: 4 });
  }
});

test('help --json lists every command and marks the interactive one', () => {
  const result = site('help', '--json');
  assert.equal(result.status, 0, result.stderr);
  const doc = JSON.parse(result.stdout) as SiteHelp;
  assert.equal(doc.command, 'help');
  const manage = doc.commands?.find((command) => command.name === 'manage');
  assert.equal(manage?.interactive, true);
  assert.equal(doc.commands?.find((command) => command.name === 'publish')?.interactive, false);
});

test('help without --json stays plain text', () => {
  const result = site('--help');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^usage: site <command>/);
});

test('manage --json is a usage error with a JSON error document', () => {
  const result = site('manage', '--json');
  assert.equal(result.status, 2);
  const doc = JSON.parse(result.stdout) as SiteFailure;
  assert.equal(doc.ok, false);
  assert.equal(doc.error.code, 2);
  assert.match(doc.error.message, /interactive/);
});
