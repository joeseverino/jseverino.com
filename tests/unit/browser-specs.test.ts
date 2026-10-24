import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { fromRoot } from '../../src/lib/site-root.ts';

test('every browser spec takes its test from the shared harness module', () => {
  const specs = fs.globSync('tests/playwright/**/*.spec.ts', { cwd: fromRoot() });
  assert.ok(specs.length > 0);
  const bypassing = specs.filter((spec) => /from '@playwright\/test'/.test(fs.readFileSync(fromRoot(spec), 'utf8')));
  assert.deepEqual(bypassing, [], 'import test and expect from tests/playwright/helpers/test.ts');
});
