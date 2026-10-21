import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { siteRoot as root } from '../../src/lib/site-root.ts';

const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('commands/docs parity', () => {
  test('docs/Development.md names every gate aggregate', () => {
    const development = read('docs/Development.md');
    for (const name of ['fast', 'check', 'browser', 'ci']) {
      assert.ok(development.includes(`mise run ${name}`), `"mise run ${name}" is missing from docs/Development.md`);
    }
    assert.ok(development.includes('mise run deploy:verify'), '"mise run deploy:verify" is missing from docs/Development.md');
  });
});
