// The wrap the preview deploy runs (bin/wrap-preview.ts) puts the sitedrift viewer on a preview
// branch's build and fills its CSP again, and leaves main's build as it was.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { wrapPreview } from '../../bin/wrap-preview.ts';
import { buildOutDir, workerConfig } from '../../src/lib/build-output.ts';
import { CSP_INLINE_MARKER } from '../../src/lib/csp.ts';
import { SITE } from '../../src/lib/site-config.ts';

const original = `<!doctype html><html><head><title>Preview guard</title><script nonce="${CSP_INLINE_MARKER}">theme()</script></head><body><h1>Original Astro output</h1></body></html>`;
const template = '/*\n  Content-Security-Policy: __CSP__\n  Reporting-Endpoints: __REPORTING_ENDPOINTS__\n\n/contact/*\n  Content-Security-Policy: __CSP_CONTACT__\n  Content-Security-Policy-Report-Only: __TT_REPORT_ONLY__\n';

async function build(branch: string): Promise<{ root: string; installed: boolean }> {
  const label = branch.replace(/[^a-z0-9-]+/gi, '-');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `jseverino-sitedrift-${label}-`));
  const client = path.join(root, buildOutDir);
  fs.mkdirSync(client, { recursive: true });
  fs.writeFileSync(path.join(client, 'index.html'), original);
  fs.writeFileSync(path.join(client, '_headers'), template);
  fs.mkdirSync(path.dirname(path.join(root, workerConfig)), { recursive: true });
  fs.writeFileSync(path.join(root, workerConfig), JSON.stringify({ name: SITE.worker, main: 'entry.mjs', assets: { directory: '../client' } }));
  const { installed } = await wrapPreview(root, { WORKERS_CI: '1', WORKERS_CI_BRANCH: branch });
  return { root, installed };
}

const preview = await build('preview/sitedrift-guard');
const production = await build('main');
const client = (root: string, ...file: string[]) => path.join(root, buildOutDir, ...file);

try {
  assert.equal(preview.installed, true);
  assert.equal(fs.existsSync(client(preview.root, '__sitedrift', 'config.json')), true);
  assert.equal(fs.existsSync(client(preview.root, '__sitedrift_source', 'index.html.txt')), true);
  assert.match(fs.readFileSync(client(preview.root, 'index.html'), 'utf8'), /"hosted":true/);
  assert.doesNotMatch(fs.readFileSync(client(preview.root, '_headers'), 'utf8'), /__CSP__/);

  assert.equal(production.installed, false);
  assert.equal(fs.existsSync(client(production.root, '__sitedrift')), false);
  assert.equal(fs.existsSync(client(production.root, '__sitedrift_source')), false);
  assert.equal(fs.readFileSync(client(production.root, 'index.html'), 'utf8'), original);

  console.log('ok       the deploy\'s wrap covers preview branches and leaves main unchanged');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error('fix: the sitedrift wrap belongs on preview branches and never on main; check bin/wrap-preview.ts, and that the build itself never wraps');
  process.exitCode = 1;
} finally {
  fs.rmSync(preview.root, { recursive: true, force: true });
  fs.rmSync(production.root, { recursive: true, force: true });
}
