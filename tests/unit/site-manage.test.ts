// site manage without a terminal: it refuses to start, and its frames render
// through the MANAGE_TUI_SMOKE / MANAGE_TUI_KEYS harness against a temp vault.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { stripVTControlCharacters } from 'node:util';
import { siteRoot } from '../../src/lib/site-root.ts';
import { tempDir, write } from './helpers/fs.ts';

let tmp = '';

before(() => {
  tmp = tempDir('site-manage-');
  write(path.join(tmp, 'vault/06 Pages/_technology-groups.md'), '## Tools\n\n| Slug | Label | Featured |\n| --- | --- | --- |\n| astro | Astro | |\n');
  write(path.join(tmp, 'vault/05 Writeups/alpha/index.md'), '---\ntitle: Alpha\npublished: true\npublished_at: 2026-01-01\nfeatured: true\nfeatured_order: 1\ntechnologies: [astro]\n---\nBody\n');
  write(path.join(tmp, 'vault/05 Writeups/beta/index.md'), '---\ntitle: Beta\npublished: false\ntechnologies: [unknown]\n---\nBody\n');
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const manage = (env: Record<string, string>) => spawnSync(process.execPath, ['bin/site.ts', 'manage'], {
  cwd: siteRoot,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, VAULT_DIR: path.join(tmp, 'vault'), MANAGE_TUI_COLUMNS: '100', ...env },
});

test('refuses to start without a terminal, naming the non-interactive commands', () => {
  const result = manage({});
  assert.equal(result.status, 2);
  assert.match(result.stderr, /interactive and needs a terminal/);
  assert.match(result.stderr, /site featured, site validate, and site status/);
});

test('the list frame shows featured order, drafts, and gate issues from site validate', () => {
  const result = manage({ MANAGE_TUI_SMOKE: 'list' });
  assert.equal(result.status, 0, result.stderr);
  const frame = stripVTControlCharacters(result.stdout);
  assert.match(frame, /1 ● {3}alpha/);
  assert.match(frame, /· ◌ ! beta/);
  assert.match(frame, /\[draft\]/);
});

test('staged moves stay staged until save', () => {
  const result = manage({ MANAGE_TUI_KEYS: 'down,f' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(stripVTControlCharacters(result.stdout), /staged: featured order · press s to save/);
});
