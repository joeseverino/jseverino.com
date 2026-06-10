// Shared process harness for the bin/ gate runners (diagnose, publish-check,
// release-check). One spawn wrapper so every gate gets the same guarantees:
// a per-command timeout (a hung Playwright run fails instead of stalling an
// unattended run forever), spawn failures (missing binary) surface as a failed
// result instead of an unresolved promise, and output handling is either
// captured for terse summaries or streamed live — never silently dropped.
import { spawn } from 'node:child_process';

export const DEFAULT_TIMEOUT_MS = 5 * 60_000;

export const COLOR = {
  green: (text) => `\x1b[32m${text}\x1b[0m`,
  red: (text) => `\x1b[31m${text}\x1b[0m`,
  yellow: (text) => `\x1b[33m${text}\x1b[0m`,
  blue: (text) => `\x1b[34m${text}\x1b[0m`,
  bold: (text) => `\x1b[1m${text}\x1b[0m`,
  dim: (text) => `\x1b[2m${text}\x1b[0m`,
  cyan: (text) => `\x1b[36m${text}\x1b[0m`,
};

export function stripAnsi(value) {
  return value.replace(/\x1b\[[0-9;]*m/g, '');
}

export function status(label, detail) {
  console.log(`${label.padEnd(12)} ${detail}`);
}

// Spawn `cmd args` and always resolve (never reject) with:
//   { code, stdout, stderr, output, duration, timedOut }
// code is non-zero whenever the command failed for any reason — non-zero exit,
// signal kill, timeout, or failure to spawn at all.
// options: cwd, env (merged over process.env), timeout (ms, 0 disables),
// stdio: 'capture' (default) buffers stdout/stderr; 'inherit' streams to the
// terminal (stdout/stderr come back empty).
export function run(cmd, args, options = {}) {
  const { cwd, env, timeout = DEFAULT_TIMEOUT_MS, stdio = 'capture' } = options;

  return new Promise((resolve) => {
    const start = Date.now();
    const inherit = stdio === 'inherit';
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let spawnError = null;
    let settled = false;

    const child = spawn(cmd, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      stdio: inherit ? 'inherit' : 'pipe',
    });

    const settle = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (timedOut) stderr += `${stderr ? '\n' : ''}[timed out after ${Math.round(timeout / 1000)}s: ${cmd} ${args.join(' ')}]`;
      if (spawnError) stderr += `${stderr ? '\n' : ''}[failed to start: ${spawnError.message}]`;
      const finalCode = spawnError || timedOut ? (code || 1) : (code ?? 1);
      resolve({
        code: finalCode,
        stdout,
        stderr,
        output: stripAnsi(`${stdout}\n${stderr}`),
        duration: Date.now() - start,
        timedOut,
      });
    };

    const timer = timeout > 0
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
          // Escalate if the process ignores SIGTERM.
          setTimeout(() => { if (!settled) child.kill('SIGKILL'); }, 5_000).unref();
        }, timeout)
      : null;

    if (!inherit) {
      child.stdout.on('data', (data) => { stdout += data.toString(); });
      child.stderr.on('data', (data) => { stderr += data.toString(); });
    }

    child.on('error', (error) => {
      spawnError = error;
      // 'close' never fires when the process could not spawn.
      setTimeout(() => settle(1), 0);
    });
    child.on('close', (code) => settle(code));
  });
}
