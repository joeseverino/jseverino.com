// site manage dev-server control against real processes. Needs lsof.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { isListening, listeners, stopDevServer, type StartedServer } from '../../bin/site/dev-server.ts';
import { tempDir } from './helpers/fs.ts';

const hasLsof = spawnSync('lsof', ['-v'], { stdio: 'ignore' }).error === undefined;
const cwd = tempDir('dev-server-');
const strays: ChildProcess[] = [];
after(() => {
  for (const child of strays) child.kill('SIGKILL');
});

async function server(port: number, { ignoreTerm = false } = {}): Promise<ChildProcess> {
  const code = `${ignoreTerm ? "process.on('SIGTERM', () => {});" : ''}require('node:net').createServer().listen(${port}, '127.0.0.1');`;
  const child = spawn(process.execPath, ['-e', code], { detached: true, stdio: 'ignore' });
  strays.push(child);
  for (let i = 0; i < 50 && !isListening(String(port)); i++) await delay(50);
  return child;
}

const freePort = async (): Promise<number> => {
  const probe = net.createServer().listen(0, '127.0.0.1');
  await new Promise((resolve) => probe.once('listening', resolve));
  const { port } = probe.address() as net.AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
};

test('listeners are the listening process only; a client connection is not one', { skip: !hasLsof }, async () => {
  const port = await freePort();
  const child = await server(port);
  const client = net.connect(port, '127.0.0.1');
  await new Promise((resolve) => client.once('connect', resolve));
  assert.deepEqual(listeners(String(port)), [child.pid]);
  client.destroy();
});

test('a stop ends the started group and leaves another listener running', { skip: !hasLsof }, async () => {
  const [ours, theirs] = [await freePort(), await freePort()];
  const child = await server(ours);
  const other = await server(theirs);
  const started: StartedServer = { pid: child.pid ?? 0, startedAt: Date.now() };
  assert.equal(await stopDevServer(started, { cwd, port: String(ours), timeoutMs: 2_000 }), true);
  assert.equal(isListening(String(ours)), false);
  assert.deepEqual(listeners(String(theirs)), [other.pid]);
});

test('a server that ignores SIGTERM is killed after the timeout', { skip: !hasLsof }, async () => {
  const port = await freePort();
  const child = await server(port, { ignoreTerm: true });
  await delay(100);
  const begun = Date.now();
  assert.equal(await stopDevServer({ pid: child.pid ?? 0, startedAt: Date.now() }, { cwd, port: String(port), timeoutMs: 300, intervalMs: 50 }), true);
  assert.ok(Date.now() - begun >= 300, 'waited for SIGTERM first');
  assert.equal(isListening(String(port)), false);
});
