// The Astro dev server as `site manage` controls it. Listeners are matched in the LISTEN state only,
// so a browser tab's client socket is never mistaken for the server.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { readJson } from '../../src/lib/json.ts';
import { spawnResult } from '../lib/run.ts';

export const DEV_PORT = process.env.DEV_PORT || '4321';

// PIDs listening on a TCP port; empty when none (lsof exits 1).
export function listeners(port: string): number[] {
  const result = spawnResult('lsof', ['-t', '-n', '-P', `-iTCP:${port}`, '-sTCP:LISTEN']);
  if (result.code !== 0) return [];
  return result.stdout.split(/\s+/).map((value) => Number.parseInt(value, 10)).filter(Number.isInteger);
}

export const isListening = (port: string): boolean => listeners(port).length > 0;

// Astro's dev-server lock file, written by whichever process serves.
export interface DevLock {
  pid: number;
  url: string;
}

export function liveDevServer(root: string): DevLock | null {
  try {
    const lock: unknown = readJson(path.join(root, '.astro/dev.json'));
    if (typeof lock !== 'object' || lock === null || !('pid' in lock) || !('url' in lock)) return null;
    const { pid, url } = lock;
    if (typeof pid !== 'number' || typeof url !== 'string') return null;
    process.kill(pid, 0);
    return { pid, url };
  } catch {
    return null;
  }
}

// What one start created: the process group it leads, and when it began.
export interface StartedServer {
  pid: number;
  startedAt: number;
}

export function startDevServer(command: readonly [string, ...string[]], { cwd, port }: { cwd: string; port: string }): StartedServer | null {
  const [bin, ...args] = command;
  const child = spawn(bin, [...args, '--port', port], { cwd, detached: true, stdio: 'ignore' });
  child.unref();
  return child.pid === undefined ? null : { pid: child.pid, startedAt: Date.now() };
}

// A negative pid probes the whole process group.
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const signal = (target: number, name: NodeJS.Signals): void => {
  try {
    process.kill(target, name);
  } catch {}
};

// The PIDs a start owns: its process group, plus the server Astro detaches
// when it detects an agent caller, named by a lock file written after the
// start and listening on the port.
function owned(server: StartedServer, { cwd, port }: { cwd: string; port: string }): { group: number; detached: number | null } {
  const lockFile = path.join(cwd, '.astro/dev.json');
  const lock = liveDevServer(cwd);
  const fresh = lock !== null && fs.existsSync(lockFile) && fs.statSync(lockFile).mtimeMs >= server.startedAt;
  const detached = fresh && lock !== null && listeners(port).includes(lock.pid) ? lock.pid : null;
  return { group: server.pid, detached };
}

// SIGTERM, then SIGKILL for whatever is still running after timeoutMs. True
// when nothing the start owned is left.
export async function stopDevServer(
  server: StartedServer,
  { cwd, port, timeoutMs = 3_000, intervalMs = 100 }: { cwd: string; port: string; timeoutMs?: number; intervalMs?: number },
): Promise<boolean> {
  const { group, detached } = owned(server, { cwd, port });
  const remaining = () => [alive(-group) ? group : null, detached !== null && alive(detached) ? detached : null].filter((pid) => pid !== null);
  signal(-group, 'SIGTERM');
  if (detached !== null) signal(detached, 'SIGTERM');
  const deadline = Date.now() + timeoutMs;
  while (remaining().length > 0 && Date.now() < deadline) await delay(intervalMs);
  if (remaining().length > 0) {
    signal(-group, 'SIGKILL');
    if (detached !== null) signal(detached, 'SIGKILL');
    await delay(intervalMs);
  }
  return remaining().length === 0;
}
