// GitHub's REST API for the bin/ scripts: one client over fetch, and the
// repository reads the deploy and land flows make with it.
import { setTimeout as delay } from 'node:timers/promises';
import { absentOn404, createSend, type Fetch } from './rest.ts';
import { spawnResult } from './run.ts';

export const API_BASE = 'https://api.github.com';
// GITHUB_TOKEN (Actions), then GH_TOKEN, then the gh CLI's login.
export const resolveToken = (env: NodeJS.ProcessEnv = process.env): string | undefined =>
  env.GITHUB_TOKEN || env.GH_TOKEN || spawnResult('gh', ['auth', 'token']).stdout.trim() || undefined;

export interface ClientOptions {
  token: string | undefined;
  // Read at each request when omitted, so a test can stand in for the global.
  fetch?: Fetch | undefined;
}

export type Client = ReturnType<typeof createClient>;

export function createClient({ token, fetch }: ClientOptions) {
  if (!token) throw new Error('no GitHub token: set GITHUB_TOKEN or GH_TOKEN, or sign in with `gh auth login`');
  const send = createSend<{ message: string }>({
    token,
    fetch,
    headers: {
      Accept: 'application/vnd.github+json',
      // The version where code scanning default setup reports javascript-typescript alone, as its PATCH takes it.
      'X-GitHub-Api-Version': '2026-03-10',
    },
    detail: ({ message }) => message,
  });
  // An error is labeled by the path alone, without the query.
  const call = (method: string, url: string, body?: unknown) => send(method, url, new URL(url).pathname, body);

  async function request<T>(method: string, path: string, body?: unknown): Promise<T | undefined> {
    const text = await (await call(method, `${API_BASE}${path}`, body)).text();
    return text ? (JSON.parse(text) as T) : undefined;
  }

  return {
    request,
    get: async <T>(path: string): Promise<T> => (await request<T>('GET', path)) as T,
    // Every page of a list, following the Link header's next page.
    list: async <T>(path: string): Promise<T[]> => {
      const items: T[] = [];
      for (let url: string | undefined = `${API_BASE}${path}`; url; ) {
        const response = await call('GET', url);
        items.push(...((await response.json()) as T[]));
        url = response.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
      }
      return items;
    },
    // Features answer 204 or 200 when on and 404 when off.
    isOn: async (path: string): Promise<boolean> => (await absentOn404(request('GET', path).then(() => true))) ?? false,
  };
}

// The client the repository reads below share, signed in on first use.
let shared: Client | undefined;
const github = (): Client => (shared ??= createClient({ token: resolveToken() }));

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

// A commit's latest run of each check. This read and requiredContexts take the client of a
// script that holds its own.
export const checkRuns = async (repository: string, sha: string, client = github()): Promise<CheckRun[]> =>
  (await client.get<{ check_runs: CheckRun[] }>(`/repos/${repository}/commits/${sha}/check-runs?per_page=100`)).check_runs;

// The conclusions a required check passes with, as branch protection counts them.
const PASSING_CONCLUSIONS: readonly string[] = ['success', 'neutral', 'skipped'];
export const passed = (check: CheckRun): boolean => check.status === 'completed' && PASSING_CONCLUSIONS.includes(check.conclusion ?? '');

interface BranchRule {
  type: string;
  parameters?: { required_status_checks?: { context: string }[] };
}

// The status-check contexts the rulesets applying to a branch require.
export const requiredContexts = async (repository: string, branch: string, client = github()): Promise<string[]> => [
  ...new Set(
    (await client.get<BranchRule[]>(`/repos/${repository}/rules/branches/${branch}`))
      .filter((rule) => rule.type === 'required_status_checks')
      .flatMap((rule) => rule.parameters?.required_status_checks ?? [])
      .map((check) => check.context),
  ),
];

// GitHub's verdict on a commit's signature.
export const commitVerification = async (repository: string, ref: string): Promise<{ verified: boolean; reason: string }> =>
  (await github().get<{ commit: { verification: { verified: boolean; reason: string } } }>(`/repos/${repository}/commits/${ref}`)).commit.verification;

export const openCodeScanningAlerts = (repository: string, tool: string): Promise<CodeScanningAlert[]> =>
  github().get<CodeScanningAlert[]>(`/repos/${repository}/code-scanning/alerts?${new URLSearchParams({ state: 'open', tool_name: tool, per_page: '100' })}`);

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
    const runs = new Map((await checkRuns(repository, sha)).map((check) => [check.name, check]));
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
