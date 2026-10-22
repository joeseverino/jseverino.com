// The Astro dev server through Astro's own background mode: `astro dev --background` starts it and
// returns once it serves, `astro dev stop` stops it, and the lock file the server writes
// (.astro/dev.json) names its pid and url.
import path from 'node:path';
import { readJson } from '../../src/lib/json.ts';
import { run, type RunResult } from '../lib/run.ts';

export const DEV_PORT = process.env.DEV_PORT || '4321';

export interface DevLock {
  pid: number;
  url: string;
}

// The lock's server while its process is alive. Astro clears a stale lock on its next start or stop.
export function devLock(root: string): DevLock | null {
  let lock: unknown;
  try {
    lock = readJson(path.join(root, '.astro/dev.json'));
  } catch {
    return null;
  }
  if (typeof lock !== 'object' || lock === null || !('pid' in lock) || !('url' in lock)) return null;
  const { pid, url } = lock;
  if (typeof pid !== 'number' || typeof url !== 'string') return null;
  try {
    process.kill(pid, 0);
  } catch {
    return null;
  }
  return { pid, url };
}

// A HEAD's status code, or null when nothing answered in time: fetch rejects
// with a TypeError when the connection fails and a TimeoutError when the
// signal fires.
export async function headStatus(url: string, timeoutMs: number): Promise<number | null> {
  try {
    const response = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    return response.status;
  } catch (error) {
    if (error instanceof TypeError || (error instanceof DOMException && error.name === 'TimeoutError')) return null;
    throw error;
  }
}

// The locked server, when it answers HTTP. A fresh server renders the home
// page on its first request, which takes seconds.
export async function servingDevServer(root: string): Promise<DevLock | null> {
  const lock = devLock(root);
  return lock && (await headStatus(lock.url, 10_000)) !== null ? lock : null;
}

// Astro's own subcommands: `astro` resolves from node_modules/.bin, which mise puts on PATH.
export const startDevServer = (root: string): Promise<RunResult> =>
  run('astro', ['dev', '--background', '--port', DEV_PORT], { cwd: root, timeout: 60_000 });

export const stopDevServer = (root: string): Promise<RunResult> =>
  run('astro', ['dev', 'stop'], { cwd: root, timeout: 30_000 });
