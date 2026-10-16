// Runs one registry audit for every gate; skip rules and the result shape live here.
import os from 'node:os';
import { firstFailureLine, summarize } from './audit-summary.ts';
import { jsonLogs, run, type RunOptions, type RunResult } from './run.ts';
import type { Audit } from '../../tests/audits/registry.ts';
import { siteRoot } from '../../src/lib/site-root.ts';

interface SkipInputs {
  platform?: NodeJS.Platform | undefined;
}

// Why an audit does not run here, or null when it does.
function skipReason(audit: Audit, { platform = process.platform }: SkipInputs = {}): string | null {
  if (audit.macosOnly && platform !== 'darwin') return 'requires macOS (the visual baselines are macOS Chromium renders)';
  return null;
}

// The exact command to reproduce an audit outside its gate.
export function rerunFor(audit: Audit): string {
  const envPrefix = Object.entries(audit.exec.env ?? {}).map(([key, value]) => `${key}=${value}`).join(' ');
  return `${envPrefix} ${audit.exec.cmd} ${audit.exec.args.join(' ')}`.trim();
}

export interface AuditResult extends RunResult {
  id: string;
  name: string;
  label: string;
  rerun: string;
  skipped: boolean;
  ok: boolean | null;
  detail: string;
}

export type RunAuditOptions = Omit<RunOptions, 'timeout'> & SkipInputs;

// Always resolves; ok is null when skipped. options pass through to run(); env merges over the audit's own.
export async function runAudit(audit: Audit, { cwd = siteRoot, env, platform, ...options }: RunAuditOptions = {}): Promise<AuditResult> {
  const base = { id: audit.id, name: audit.name, label: audit.label, rerun: rerunFor(audit) };
  const reason = skipReason(audit, { platform });
  if (reason) {
    return {
      ...base, skipped: true, ok: null, detail: `skipped (${reason})`,
      code: 0, stdout: '', stderr: '', output: '', duration: 0, timedOut: false,
    };
  }
  const merged = { ...audit.exec.env, ...(audit.servesBuild ? { PREBUILT: '1' } : {}), ...env };
  const args = audit.exec.jsonArgs && jsonLogs({ ...process.env, ...merged }) ? [...audit.exec.args, ...audit.exec.jsonArgs] : audit.exec.args;
  const result = await run(audit.exec.cmd, args, {
    cwd,
    env: merged,
    timeout: audit.timeout,
    ...options,
  });
  const ok = result.code === 0;
  return {
    ...base, skipped: false, ok,
    detail: ok ? summarize(audit, result.output) : firstFailureLine(result.output),
    ...result,
  };
}

// Concurrency: heavy audits (browser suite, about 1.5 GB) run one at a time below 12 GB of memory.
const GB = 2 ** 30;
const AUDIT_CONCURRENCY = Math.max(1, Math.min(os.availableParallelism(), Math.floor(os.totalmem() / (2 * GB))));
const HEAVY_CONCURRENCY = os.totalmem() < 12 * GB ? 1 : 3;

export interface RunAuditsOptions extends RunAuditOptions {
  // Per-audit options (env merges over the shared env).
  optionsFor?: (audit: Audit) => RunAuditOptions;
  // Each result, in registry order, as soon as it and every audit before it finished.
  onResult?: (result: AuditResult, audit: Audit) => void;
  // Stop at the first failure in registry order; audits still running are stopped.
  stopOnFailure?: boolean;
}

// The audits concurrently, reported in order. Returns the reported results:
// all of them, or everything through the first failure under stopOnFailure.
export async function runAudits(audits: readonly Audit[], {
  optionsFor = () => ({}),
  onResult = () => {},
  stopOnFailure = false,
  env,
  ...options
}: RunAuditsOptions = {}): Promise<AuditResult[]> {
  const controller = new AbortController();
  const results: (AuditResult | undefined)[] = new Array(audits.length);
  const reported: AuditResult[] = [];
  let next = 0;
  let heavyRunning = 0;
  const heavyWaiters: (() => void)[] = [];
  const locks = new Map<string, Promise<unknown>>();

  const flush = (): void => {
    for (let result = results[reported.length]; result && !controller.signal.aborted; result = results[reported.length]) {
      const audit = audits[reported.length];
      reported.push(result);
      if (audit) onResult(result, audit);
      if (stopOnFailure && result.ok === false) controller.abort();
    }
  };
  const heavySlot = async (): Promise<void> => {
    while (heavyRunning >= HEAVY_CONCURRENCY) await new Promise<void>((resolve) => heavyWaiters.push(resolve));
    heavyRunning += 1;
  };

  await Promise.all(Array.from({ length: Math.min(AUDIT_CONCURRENCY, audits.length) }, async () => {
    while (next < audits.length && !controller.signal.aborted) {
      const index = next++;
      const audit = audits[index];
      if (!audit) continue;
      if (audit.heavy) await heavySlot();
      const own = optionsFor(audit);
      const merged = env || own.env ? { ...env, ...own.env } : undefined;
      const held = audit.lock ? locks.get(audit.lock) : undefined;
      const running = (held ?? Promise.resolve()).then(() => runAudit(audit, { ...options, ...own, env: merged, signal: controller.signal }));
      if (audit.lock) locks.set(audit.lock, running);
      results[index] = await running;
      if (audit.heavy) {
        heavyRunning -= 1;
        heavyWaiters.shift()?.();
      }
      flush();
    }
  }));
  return reported;
}
