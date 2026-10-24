// Process harness for the bin/ tools: per-command timeout, spawn failures as failed results,
// output captured or streamed.
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { text } from 'node:stream/consumers';
import { stripVTControlCharacters } from 'node:util';

const MINUTE_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 5 * MINUTE_MS;

// `site --json` sets SITE_JSON=1 so the static build and astro-check pass `--json` to Astro.
export const JSON_LOGS_ENV = 'SITE_JSON';
export const jsonLogs = (env: NodeJS.ProcessEnv = process.env): boolean => env[JSON_LOGS_ENV] === '1';
// A cold content sync re-encodes every image; callers pass this explicitly.
export const SYNC_TIMEOUT_MS = 15 * MINUTE_MS;
export const BUILD_TIMEOUT_MS = 10 * MINUTE_MS;
export const GATE_TIMEOUT_MS = 30 * MINUTE_MS;

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  output: string;
  duration: number;
  timedOut: boolean;
}

export interface RunOptions {
  cwd?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  timeout?: number | undefined;
  stdio?: 'capture' | 'inherit' | 'stderr' | undefined;
}

export interface SpawnOptions {
  cwd?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  input?: string | undefined;
  timeout?: number | undefined;
  stdio?: 'capture' | 'inherit' | 'ignore' | undefined;
}

export interface SpawnResult {
  code: number;
  stdout: string;
  stderr: string;
  error: NodeJS.ErrnoException | undefined;
}

export interface RunSyncOptions {
  cwd?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  input?: string | undefined;
  raw?: boolean | undefined;
}

// Why a command failed, for its error: its stderr, else its stdout, else why it never started.
export const failureDetail = (
  cmd: string,
  args: readonly string[],
  { stdout, stderr, error }: { stdout: string; stderr: string; error?: Error | undefined },
): string => stderr.trim() || stdout.trim() || error?.message || `${cmd} ${args.join(' ')} failed`;

// Synchronous run(): trimmed stdout of a command that must succeed, else an error carrying its output.
// env merges over process.env; input goes to stdin; raw keeps the output untrimmed (porcelain).
export function runSync(cmd: string, args: readonly string[], { cwd, env, input, raw = false }: RunSyncOptions = {}): string {
  const result = spawnResult(cmd, args, { cwd, env, input });
  if (result.code !== 0) throw new Error(failureDetail(cmd, args, result));
  return raw ? result.stdout : result.stdout.trim();
}

// The one synchronous spawn: never throws. code is non-zero for any failure
// (exit status, signal, timeout, or no such binary, which error then names).
// stdio 'capture' (default) returns the output; 'inherit' streams it.
export function spawnResult(cmd: string, args: readonly string[], { cwd, env, input, timeout, stdio = 'capture' }: SpawnOptions = {}): SpawnResult {
  const result = spawnSync(cmd, args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    encoding: 'utf8',
    input,
    timeout,
    stdio: stdio === 'capture' ? 'pipe' : stdio,
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error,
  };
}

// Never rejects: code is non-zero on non-zero exit, signal, timeout, or spawn failure. timeout 0 disables it.
// The timeout sends SIGKILL: spawn signals once, and a child that ignores SIGTERM would outlive it.
export async function run(cmd: string, args: readonly string[], options: RunOptions = {}): Promise<RunResult> {
  const { cwd, env, timeout = DEFAULT_TIMEOUT_MS, stdio = 'capture' } = options;
  const start = Date.now();
  const child = spawn(cmd, args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    stdio: stdio === 'stderr' ? ['inherit', process.stderr, process.stderr] : stdio === 'inherit' ? 'inherit' : 'pipe',
    timeout,
    killSignal: 'SIGKILL',
  });
  const [stdout, stderr, exit] = await Promise.all([
    child.stdout ? text(child.stdout) : '',
    child.stderr ? text(child.stderr) : '',
    // A failed spawn emits 'error', which rejects once().
    once(child, 'close').then(
      ([code]) => ({ code: code as number | null, error: undefined }),
      (error: Error) => ({ code: null, error }),
    ),
  ]);
  // Only spawn's timeout kills the child, so a killed child timed out.
  const timedOut = child.killed;
  const notes = [
    stderr,
    timedOut && `[timed out after ${Math.round(timeout / 1000)}s: ${cmd} ${args.join(' ')}]`,
    exit.error && `[failed to start: ${exit.error.message}]`,
  ]
    .filter(Boolean)
    .join('\n');
  return {
    code: exit.code ?? 1,
    stdout,
    stderr: notes,
    output: stripVTControlCharacters(`${stdout}\n${notes}`),
    duration: Date.now() - start,
    timedOut,
  };
}
