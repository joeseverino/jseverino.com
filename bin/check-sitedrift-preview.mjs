#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const cli = path.join(root, 'node_modules/sitedrift/sitedrift.mjs');
const original = '<!doctype html><html><head><title>Preview guard</title></head><body><h1>Original Astro output</h1></body></html>';

function build(branch) {
  const label = branch.replace(/[^a-z0-9-]+/gi, '-');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `jseverino-sitedrift-${label}-`));
  fs.writeFileSync(path.join(dir, 'index.html'), original);
  const result = spawnSync(
    process.execPath,
    [cli, 'cloudflare', '--dir', dir, '--live', 'https://jseverino.com', '--brand', 'Joe Severino'],
    {
      cwd: root,
      env: { ...process.env, CF_PAGES: '1', CF_PAGES_BRANCH: branch },
      encoding: 'utf8',
    },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `sitedrift exited ${result.status}`);
  }
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

  console.log('ok preview wrapped; main unchanged');
} finally {
  fs.rmSync(preview, { recursive: true, force: true });
  fs.rmSync(production, { recursive: true, force: true });
}
