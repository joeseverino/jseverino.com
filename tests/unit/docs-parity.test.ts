import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { siteRoot as root } from '../../src/lib/site-root.ts';
import { packageScripts } from '../../src/lib/json.ts';

const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('commands/docs parity', () => {
  test('docs/Development.md names every gate aggregate', () => {
    const development = read('docs/Development.md');
    for (const name of ['fast', 'check', 'browser', 'ci']) {
      assert.ok(development.includes(`mise run ${name}`), `"mise run ${name}" is missing from docs/Development.md`);
    }
    assert.ok(development.includes('npm run deploy:verify'), '"npm run deploy:verify" is missing from docs/Development.md');
  });

  test('docs/Commands.md covers every script in package.json', () => {
    const commands = read('docs/Commands.md');
    for (const name of Object.keys(packageScripts())) {
      assert.ok(commands.includes(`npm run ${name}`), `"${name}" is missing from docs/Commands.md`);
    }
  });
});
