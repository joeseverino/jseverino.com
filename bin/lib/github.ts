// The gh CLI as functions, for scripts that run where gh is already
// authenticated: locally, and in Actions through GH_TOKEN.
import { setTimeout as delay } from 'node:timers/promises';
import { runSync } from './run.ts';

// The REST fields the callers read.
export interface CheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  details_url: string;
}

export interface CodeScanningAlert {
  number: number;
  html_url: string;
}

// The caller names the response shape; gh returns parsed JSON.
export function ghApi<T>(pathname: string, params: Record<string, string | number> = {}): T {
  const args = ['api', pathname, '--method', 'GET'];
  for (const [key, value] of Object.entries(params)) args.push('-f', `${key}=${value}`);
  return JSON.parse(runSync('gh', args)) as T;
}

export const checkRuns = (repository: string, sha: string): CheckRun[] =>
  ghApi<{ check_runs: CheckRun[] }>(`repos/${repository}/commits/${sha}/check-runs`, { per_page: 100 }).check_runs;

// The conclusions a required check passes with, as branch protection counts them.
export const PASSING_CONCLUSIONS: readonly string[] = ['success', 'neutral', 'skipped'];
export const passed = (check: CheckRun): boolean => check.status === 'completed' && PASSING_CONCLUSIONS.includes(check.conclusion ?? '');

interface BranchRule {
  type: string;
  parameters?: { required_status_checks?: { context: string }[] };
}

// The status-check contexts the rulesets applying to a branch require.
export const requiredContexts = (repository: string, branch: string): string[] => [
  ...new Set(ghApi<BranchRule[]>(`repos/${repository}/rules/branches/${branch}`)
    .filter((rule) => rule.type === 'required_status_checks')
    .flatMap((rule) => rule.parameters?.required_status_checks ?? [])
    .map((check) => check.context)),
];

export const openCodeScanningAlerts = (repository: string, tool: string): CodeScanningAlert[] =>
  ghApi<CodeScanningAlert[]>(`repos/${repository}/code-scanning/alerts`, { state: 'open', tool_name: tool, per_page: 100 });

export interface AwaitChecksOptions {
  deadline: number;
  intervalMs?: number;
  // Return as soon as any named run completes without passing.
  failFast?: boolean;
  // Each poll that is still waiting: the names not yet reported, and those not completed.
  onPending?: (state: { missing: string[]; pending: string[] }) => void;
}

// Polls a commit's check runs until every named one has completed (or, with
// failFast, one has failed): all the commit's runs then, or null once the
// deadline passes first.
export async function awaitChecks(
  repository: string,
  sha: string,
  names: readonly string[],
  { deadline, intervalMs = 10_000, failFast = false, onPending = () => {} }: AwaitChecksOptions,
): Promise<CheckRun[] | null> {
  for (;;) {
    const runs = new Map(checkRuns(repository, sha).map((check) => [check.name, check]));
    const failed = names.some((name) => {
      const check = runs.get(name);
      return check?.status === 'completed' && !passed(check);
    });
    if (failFast && failed) return [...runs.values()];
    const missing = names.filter((name) => !runs.has(name));
    const pending = names.filter((name) => runs.get(name)?.status !== 'completed');
    if (missing.length === 0 && pending.length === 0) return [...runs.values()];
    if (Date.now() >= deadline) return null;
    onPending({ missing, pending });
    await delay(intervalMs);
  }
}
