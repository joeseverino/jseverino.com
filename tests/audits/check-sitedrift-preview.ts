#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runSync } from '../../bin/lib/run.ts';
import { SITE, SITE_ORIGIN } from '../../src/lib/site-config.ts';
import { siteRoot } from '../../src/lib/site-root.ts';

const cli = path.join(siteRoot, 'node_modules/sitedrift/sitedrift.mjs');
const original = '<!doctype html><html><head><title>Preview guard</title></head><body><h1>Original Astro output</h1></body></html>';

function build(branch: string): string {
  const label = branch.replace(/[^a-z0-9-]+/gi, '-');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `jseverino-sitedrift-${label}-`));
  fs.writeFileSync(path.join(dir, 'index.html'), original);
  runSync(
    process.execPath,
    [cli, 'cloudflare', '--dir', dir, '--live', SITE_ORIGIN, '--brand', SITE.owner],
    { cwd: siteRoot, env: { CF_PAGES: '1', CF_PAGES_BRANCH: branch } },
  );
  return dir;
}

const preview = build('preview/sitedrift-guard');
const production = build('main');

try {
  assert.equal(fs.existsSync(path.join(preview, '__sitedrift', 'config.json')), true);
  assert.equal(fs.existsSync(path.join(preview, '__sitedrift_source', 'index.html.txt')), true);
  assert.match(fs.readFileSync(path.join(preview, 'index.html'), 'utf8'), /"hosted":true/);

  assert.equal(fs.existsSync(path.join(production, '__sitedrift')), false);
  assert.equal(fs.existsSync(path.join(production, '__sitedrift_source')), false);
  assert.equal(fs.readFileSync(path.join(production, 'index.html'), 'utf8'), original);

  console.log('ok       preview wrapped; main unchanged');
} finally {
  fs.rmSync(preview, { recursive: true, force: true });
  fs.rmSync(production, { recursive: true, force: true });
}
