// Shared `site` plumbing. Under --json progress goes to stderr and stdout holds only the final JSON document.
import { styleText } from 'node:util';
import type { Preflight } from '../lib/preflight.ts';
import { run } from '../lib/run.ts';
import { siteRoot } from '../../src/lib/site-root.ts';
import { EXIT, type ExitCode, type ScriptRun } from './types.ts';

export { EXIT };

export interface SiteErrorOptions {
  code?: ExitCode;
  result?: object;
  fix?: string | undefined;
}

// A failure with its exit code and whatever partial result the caller should see.
export class SiteError extends Error {
  code: ExitCode;
  result: object;
  fix: string | undefined;

  constructor(message: string, { code = EXIT.failed, result = {}, fix }: SiteErrorOptions = {}) {
    super(message);
    this.code = code;
    this.result = result;
    this.fix = fix;
  }
}

// A library's own error type as a SiteError; anything else propagates.
export async function translate<T, E extends Error>(
  work: () => T | Promise<T>,
  type: abstract new (...args: never[]) => E,
  toSiteError: (error: E) => SiteError,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof type) throw toSiteError(error);
    throw error;
  }
}

export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function assertSlug(slug: string | undefined): string {
  if (slug === undefined || !SLUG.test(slug)) {
    throw new SiteError(`slug must be lowercase-kebab-case (a-z, 0-9, hyphens): '${slug ?? ''}'`, { code: EXIT.usage });
  }
  return slug;
}

type Line = (label: string, detail: string) => void;

export interface Output {
  json: boolean;
  step: Line;
  ok: Line;
  warn: Line;
  fail: Line;
  text: (text: string) => void;
}

export function createOutput({ json = false, quiet = false } = {}): Output {
  const stream = json ? process.stderr : process.stdout;
  const write = (color: 'dim' | 'green' | 'yellow' | 'red', label: string, detail: string) => {
    if (quiet) return;
    stream.write(`${styleText(color, label.padEnd(10), { stream })} ${detail}\n`);
  };
  return {
    json,
    step: (label, detail) => write('dim', label, detail),
    ok: (label, detail) => write('green', label, detail),
    warn: (label, detail) => write('yellow', label, detail),
    fail: (label, detail) => write('red', label, detail),
    text: (text) => { if (!quiet) stream.write(`${text}\n`); },
  };
}

// Preflight failures stop with every fix listed.
export function requireReady(ready: Preflight, out: Output): void {
  for (const check of ready.checks) (check.ok ? out.step : out.fail)('preflight', check.detail);
  if (ready.ok) return;
  throw new SiteError(`preflight failed: ${ready.failed.map((check) => check.name).join(', ')}`, {
    code: EXIT.preflight,
    result: { preflight: ready.checks },
    fix: ready.failed.map((check) => check.fix).join('; '),
  });
}

export interface ScriptOptions {
  out: Output;
  root?: string;
  env?: NodeJS.ProcessEnv;
  timeout?: number;
}

// A repo script: streamed for people, captured for --json callers.
export async function runScript(script: string, args: readonly string[], { out, root = siteRoot, env, timeout = 0 }: ScriptOptions): Promise<ScriptRun> {
  const result = await run(process.execPath, [script, ...args], {
    cwd: root,
    env,
    timeout,
    stdio: out.json ? 'capture' : 'inherit',
  });
  return { ok: result.code === 0, exitCode: result.code, ...(out.json ? { output: result.output.trim() } : {}) };
}
