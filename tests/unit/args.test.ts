import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parse, positiveInt } from '../../bin/lib/args.ts';
import { run } from '../../bin/lib/run.ts';
import { siteRoot } from '../../src/lib/site-root.ts';

test('an unknown flag throws, and so does a positional where the script takes none', () => {
  assert.throws(() => parse({ args: ['--chek'], options: { check: { type: 'boolean' } } }), /Unknown option '--chek'/);
  assert.throws(() => parse({ args: ['stray'] }), /Unexpected argument 'stray'/);
});

test('a mistyped flag exits 2 before the script does any work', async () => {
  const result = await run(process.execPath, ['bin/sync-contact-openapi.ts', '--chek'], { cwd: siteRoot });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /Unknown option '--chek'/);
  assert.equal(result.stdout, '');
});

test('positiveInt: a whole number at or above the floor, else undefined', () => {
  assert.equal(positiveInt('3'), 3);
  assert.equal(positiveInt('390', 200), 390);
  for (const value of ['0', '-1', '1.5', '', 'ten']) assert.equal(positiveInt(value), undefined, value);
  assert.equal(positiveInt('199', 200), undefined);
});
