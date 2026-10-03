// Shared process harness for the bin/ gate runners (diagnose, publish-check,
// release-check): a per-command timeout (a hung Playwright run fails instead of
// stalling an unattended run), spawn failures (missing binary) as a failed
// result instead of an unresolved promise, and output either captured for
// terse summaries or streamed live.
import { spawn, spawnSync } from 'node:child_process';
import { stripVTControlCharacters } from 'node:util';

export const DEFAULT_TIMEOUT_MS = 5 * 60_000;

// `site --json` sets SITE_JSON=1 for every process it starts. The static build
// and the astro-check audit then pass `--json` to Astro, whose logger prints
// one {message,label,level} line per event instead of formatted text.
export const JSON_LOGS_ENV = 'SITE_JSON';
export const jsonLogs = (env: NodeJS.ProcessEnv = process.env): boolean => env[JSON_LOGS_ENV] === '1';
// A cold content sync re-encodes every image; callers pass this explicitly.
export const SYNC_TIMEOUT_MS = 15 * 60_000;

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
  heartbeatMs?: number | undefined;
  onHeartbeat?: ((elapsedMs: number) => void) | undefined;
  signal?: AbortSignal | undefined;
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
  raw?: boolean | undefined;
}

export function status(label: string, detail: string): void {
  console.log(`${label.padEnd(12)} ${detail}`);
}

// Synchronous companion to run(): the trimmed stdout of a command that must
// succeed, or an error carrying its output. For short git/npm queries whose
// output is an input to the next step. env merges over process.env; raw keeps
// the output untrimmed (porcelain formats where a leading space is a field).
export function runSync(cmd: string, args: readonly string[], { cwd, env, raw = false }: RunSyncOptions = {}): string {
  const result = spawnResult(cmd, args, { cwd, env });
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || result.error?.message;
    throw new Error(detail || `${cmd} ${args.join(' ')} failed`);
  }
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

// Spawn `cmd args` and always resolve (never reject) with:
//   { code, stdout, stderr, output, duration, timedOut }
// code is non-zero whenever the command failed: non-zero exit, signal kill,
// timeout, or failure to spawn.
// options: cwd, env (merged over process.env), timeout (ms, 0 disables),
// heartbeatMs + onHeartbeat(elapsedMs) for quiet long-running captures,
// signal to stop the command early (it then fails like a timeout),
// stdio: 'capture' (default) buffers stdout/stderr; 'inherit' streams to the
// terminal (stdout/stderr come back empty); 'stderr' streams both to stderr,
// keeping stdout free for a caller's own machine-readable output.
export function run(cmd: string, args: readonly string[], options: RunOptions = {}): Promise<RunResult> {
  const {
    cwd, env, timeout = DEFAULT_TIMEOUT_MS, stdio = 'capture',
    heartbeatMs = 0, onHeartbeat = () => {}, signal,
  } = options;

  return new Promise((resolve) => {
    const start = Date.now();
    const inherit = stdio !== 'capture';
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let spawnError: Error | null = null;
    let settled = false;

    const child = spawn(cmd, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      stdio: stdio === 'stderr' ? ['inherit', process.stderr, process.stderr] : inherit ? 'inherit' : 'pipe',
    });

    const settle = (code: number | null) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', stop);
      clearTimeout(timer);
      clearInterval(heartbeat);
      if (timedOut) stderr += `${stderr ? '\n' : ''}[timed out after ${Math.round(timeout / 1000)}s: ${cmd} ${args.join(' ')}]`;
      if (spawnError) stderr += `${stderr ? '\n' : ''}[failed to start: ${spawnError.message}]`;
      const finalCode = spawnError || timedOut ? (code || 1) : (code ?? 1);
      resolve({
        code: finalCode,
        stdout,
        stderr,
        output: stripVTControlCharacters(`${stdout}\n${stderr}`),
        duration: Date.now() - start,
        timedOut,
      });
    };

    const stop = () => {
      child.kill('SIGTERM');
      // Escalate if the process ignores SIGTERM.
      setTimeout(() => { if (!settled) child.kill('SIGKILL'); }, 5_000).unref();
    };
    signal?.addEventListener('abort', stop, { once: true });
    const timer = timeout > 0
      ? setTimeout(() => {
          timedOut = true;
          stop();
        }, timeout)
      : undefined;
    const heartbeat = heartbeatMs > 0
      ? setInterval(() => onHeartbeat(Date.now() - start), heartbeatMs)
      : undefined;
    heartbeat?.unref();

    if (!inherit) {
      child.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
      child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });
    }

    child.on('error', (error) => {
      spawnError = error;
      // 'close' never fires when the process could not spawn.
      setTimeout(() => settle(1), 0);
    });
    child.on('close', (code) => settle(code));
  });
}
