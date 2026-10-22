// The dev server as site manage and site dev see it: Astro's lock file, and an answer at its url.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { devLock, headStatus, servingDevServer } from '../../bin/site/dev-server.ts';
import { scratchDirs } from './helpers/fs.ts';

const server = http.createServer((request, response) =>
  (request.url === '/moved' ? response.writeHead(301, { location: '/' }) : response.writeHead(204)).end());
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
const dirs = scratchDirs('dev-server-');
after(() => {
  server.close();
  dirs.cleanup();
});

// A port nothing listens on: one the kernel handed out, then closed.
const closedUrl = async (): Promise<string> => {
  const probe = http.createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return `http://127.0.0.1:${port}/`;
};

function root(lock?: unknown): string {
  const dir = dirs.make();
  if (lock !== undefined) {
    fs.mkdirSync(path.join(dir, '.astro'));
    fs.writeFileSync(path.join(dir, '.astro/dev.json'), typeof lock === 'string' ? lock : JSON.stringify(lock));
  }
  return dir;
}

// A pid no process holds: a child that has already exited.
const deadPid = (): number => spawnSync(process.execPath, ['-e', '']).pid;

test('no lock, a malformed lock, or a dead pid is no server', () => {
  assert.equal(devLock(root()), null);
  assert.equal(devLock(root('{not json')), null);
  assert.equal(devLock(root({ pid: 'x', url })), null);
  assert.equal(devLock(root({ pid: deadPid(), url })), null);
});

test('a lock whose process lives names the server', () => {
  assert.deepEqual(devLock(root({ pid: process.pid, url, port: 1, background: true })), { pid: process.pid, url });
});

test('a live lock serves only when its url answers', async () => {
  assert.deepEqual(await servingDevServer(root({ pid: process.pid, url })), { pid: process.pid, url });
  assert.equal(await servingDevServer(root({ pid: process.pid, url: await closedUrl() })), null);
});

test('headStatus is the status code, redirects unfollowed, or null when nothing answers', async () => {
  assert.equal(await headStatus(url, 1_000), 204);
  assert.equal(await headStatus(`${url}moved`, 1_000), 301);
  assert.equal(await headStatus(await closedUrl(), 1_000), null);
});
