import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { configProblems, wrapPreview } from '../../bin/wrap-preview.ts';
import { buildOutDir, workerConfig } from '../../src/lib/build-output.ts';
import { CSP_INLINE_MARKER } from '../../src/lib/csp.ts';
import { SITE } from '../../src/lib/site-config.ts';
import { scratchDirs, write } from './helpers/fs.ts';

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

describe('the wrap the preview deploy runs', () => {
  const scratch = scratchDirs('wrap-preview-');
  after(scratch.cleanup);

  const page = `<!doctype html><html><head><title>Preview guard</title><script nonce="${CSP_INLINE_MARKER}">theme()</script></head><body><h1>Original Astro output</h1></body></html>`;
  const headers = '/*\n  Content-Security-Policy: __CSP__\n  Reporting-Endpoints: __REPORTING_ENDPOINTS__\n\n/contact/*\n  Content-Security-Policy: __CSP_CONTACT__\n  Content-Security-Policy-Report-Only: __TT_REPORT_ONLY__\n';

  // A minimal adapter build, wrapped as Workers CI would for the branch.
  async function wrapBuild(branch: string) {
    const build = scratch.make();
    const client = (...file: string[]) => path.join(build, buildOutDir, ...file);
    write(client('index.html'), page);
    write(client('_headers'), headers);
    write(path.join(build, workerConfig), JSON.stringify(adapter));
    const result = await wrapPreview(build, { WORKERS_CI: '1', WORKERS_CI_BRANCH: branch });
    return { result, client };
  }

  test('a preview branch gets the sitedrift viewer and a filled CSP', async () => {
    const { result, client } = await wrapBuild('preview/sitedrift-guard');
    assert.equal(result.installed, true);
    assert.ok(fs.existsSync(client('__sitedrift', 'config.json')));
    assert.ok(fs.existsSync(client('__sitedrift_source', 'index.html.txt')));
    assert.match(fs.readFileSync(client('index.html'), 'utf8'), /"hosted":true/);
    assert.doesNotMatch(fs.readFileSync(client('_headers'), 'utf8'), /__CSP__/);
  });

  test('main\'s build is left as the adapter wrote it', async () => {
    const { result, client } = await wrapBuild('main');
    assert.equal(result.installed, false);
    assert.equal(fs.existsSync(client('__sitedrift')), false);
    assert.equal(fs.existsSync(client('__sitedrift_source')), false);
    assert.equal(fs.readFileSync(client('index.html'), 'utf8'), page);
  });
});
