// Drives site manage via MANAGE_TUI_SMOKE / MANAGE_TUI_KEYS against a temp vault.
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
  write(path.join(tmp, 'vault/00 Templates/Writeup.md'), '---\ntitle: {{title}}\npublished: false\n---\nBody\n');
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

test('discard leaves the vault unchanged and save applies the staged publish state', () => {
  const alpha = path.join(tmp, 'vault/05 Writeups/alpha/index.md');
  const original = fs.readFileSync(alpha, 'utf8');
  const discard = manage({ MANAGE_TUI_KEYS: 'p,q,d' });
  assert.equal(discard.status, 0, discard.stderr);
  assert.equal(fs.readFileSync(alpha, 'utf8'), original);

  const save = manage({ MANAGE_TUI_KEYS: 'p,s' });
  assert.equal(save.status, 0, save.stderr);
  assert.match(fs.readFileSync(alpha, 'utf8'), /published: false/);
  assert.match(stripVTControlCharacters(save.stdout), /saved/);
});

test('a scaffold created during the session can be edited and saved without a stale plan', () => {
  const result = manage({ MANAGE_TUI_KEYS: 'n,gamma,enter,enter,ctrl-u,New title,enter,esc,s' });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(fs.readFileSync(path.join(tmp, 'vault/05 Writeups/gamma/index.md'), 'utf8'), /^title: New title$/m);
});

test('a scaffold does not absorb an outside edit made after the session loaded', async () => {
  process.env.VAULT_DIR = path.join(tmp, 'vault');
  const { load, createWriteup } = await import('../../bin/site/manage-model.ts');
  const model = load();
  const loaded = model.sourceFingerprint;
  const alpha = path.join(tmp, 'vault/05 Writeups/alpha/index.md');
  fs.writeFileSync(alpha, fs.readFileSync(alpha, 'utf8').replace(/^title: .*$/m, 'title: Edited elsewhere'));
  assert.ok(createWriteup(model, 'delta'), stripVTControlCharacters(model.flash));
  assert.equal(model.sourceFingerprint, loaded);
});
