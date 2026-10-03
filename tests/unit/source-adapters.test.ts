import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createVaultSource, isConflictCopy } from '../../bin/content-sync/source-adapters.ts';

test('conflict copies: a numbered suffix before the extension or at the end of a name', () => {
  for (const name of ['home 2.md', 'some-writeup 2', 'index 13.md']) assert.equal(isConflictCopy(name), true, name);
  for (const name of ['home.md', 'vsftpd-2-3-4', 'some-writeup', 'v2.md']) assert.equal(isConflictCopy(name), false, name);
});

test('vault source: iCloud conflict copies never become slugs', async () => {
  const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-source-'));
  try {
    for (const dir of ['05 Writeups/foo', '05 Writeups/foo 2', '06 Pages/home', '06 Pages/home 2']) {
      fs.mkdirSync(path.join(vaultRoot, dir), { recursive: true });
      fs.writeFileSync(path.join(vaultRoot, dir, 'index.md'), '---\npublished: true\n---\nBody\n');
    }
    const source = createVaultSource({ vaultRoot });
    assert.deepEqual((await source.writeups()).map((entry) => entry.slug), ['foo']);
    assert.deepEqual((await source.pages()).map((entry) => entry.slug), ['home']);
  } finally {
    fs.rmSync(vaultRoot, { recursive: true, force: true });
  }
});
