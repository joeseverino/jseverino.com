// The GitHub repository posture in .github/repo.json against the live repository.
// bin/github.ts is the CLI; the check / plan / apply flow is bin/lib/drift.ts.
import { applySteps, changedKeys, fields, item, loadDesired as load, pick, same, type Fetch, type Item, type Run } from './drift.ts';

export const API_BASE = 'https://api.github.com';

export interface RulesetSpec {
  name: string;
  target: 'branch';
  enforcement: 'active' | 'evaluate' | 'disabled';
  bypass_actors: { actor_id: number; actor_type: string; bypass_mode: 'always' | 'pull_request' }[];
  conditions: Record<string, unknown>;
  rules: { type: string; parameters?: Record<string, unknown> }[];
}

type Status = 'enabled' | 'disabled';

export interface DesiredState {
  $schema?: string;
  repository: string;
  settings: {
    allow_squash_merge: boolean;
    allow_merge_commit: boolean;
    allow_rebase_merge: boolean;
    allow_auto_merge: boolean;
    delete_branch_on_merge: boolean;
    squash_merge_commit_title: 'PR_TITLE' | 'COMMIT_OR_PR_TITLE';
    squash_merge_commit_message: 'PR_BODY' | 'COMMIT_MESSAGES' | 'BLANK';
    has_wiki: boolean;
  };
  security: {
    secret_scanning: Status;
    secret_scanning_push_protection: Status;
    dependabot_security_updates: Status;
    vulnerability_alerts: boolean;
    private_vulnerability_reporting: boolean;
  };
  actions: {
    allowed_actions: 'all' | 'local_only' | 'selected';
    sha_pinning_required: boolean;
    default_workflow_permissions: 'read' | 'write';
    can_approve_pull_request_reviews: boolean;
  };
  variables: Record<string, string>;
  ruleset: RulesetSpec;
}

export interface LiveState {
  repo: Record<string, unknown>;
  vulnerabilityAlerts: boolean;
  privateReporting: boolean;
  permissions: Record<string, unknown>;
  workflow: Record<string, unknown>;
  variables: Record<string, string>;
  ruleset: (Record<string, unknown> & { id: number }) | null;
}

export const loadDesired = (file: string, schemaFile: string): DesiredState => load<DesiredState>(file, schemaFile);

export class GitHubError extends Error {
  status: number;

  constructor(method: string, path: string, status: number, message?: string) {
    super(`${method} ${path} → ${status}${message ? ` (${message})` : ''}`);
    this.status = status;
  }
}

export interface ClientOptions {
  token: string | undefined;
  fetch?: Fetch;
}

export type Client = ReturnType<typeof createClient>;

// The token only ever goes into the Authorization header.
export function createClient({ token, fetch = globalThis.fetch }: ClientOptions) {
  if (!token) throw new Error('GITHUB_TOKEN is not set (and `gh auth token` gave none)');

  async function request<T>(method: string, path: string, body?: unknown): Promise<T | undefined> {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const payload: { message?: string } = await response.json().catch(() => ({}));
      throw new GitHubError(method, path, response.status, payload.message);
    }
    const text = await response.text();
    return text ? (JSON.parse(text) as T) : undefined;
  }

  return {
    request,
    get: async <T>(path: string): Promise<T> => (await request<T>('GET', path)) as T,
    // Features answer 204 or 200 when on and 404 when off.
    isOn: async (path: string): Promise<boolean> => {
      try {
        await request('GET', path);
        return true;
      } catch (error) {
        if (error instanceof GitHubError && error.status === 404) return false;
        throw error;
      }
    },
  };
}

export async function readLive(client: Client, desired: DesiredState): Promise<LiveState> {
  const base = `/repos/${desired.repository}`;
  const rulesets = await client.get<{ id: number; name: string }[]>(`${base}/rulesets`);
  const found = rulesets.find((entry) => entry.name === desired.ruleset.name);
  return {
    repo: await client.get<Record<string, unknown>>(base),
    vulnerabilityAlerts: await client.isOn(`${base}/vulnerability-alerts`),
    privateReporting: Boolean(fields(await client.get(`${base}/private-vulnerability-reporting`)).enabled),
    permissions: await client.get<Record<string, unknown>>(`${base}/actions/permissions`),
    workflow: await client.get<Record<string, unknown>>(`${base}/actions/permissions/workflow`),
    variables: Object.fromEntries((await client.get<{ variables: { name: string; value: string }[] }>(`${base}/actions/variables?per_page=100`)).variables.map(({ name, value }) => [name, value])),
    ruleset: found ? await client.get<Record<string, unknown> & { id: number }>(`${base}/rulesets/${found.id}`) : null,
  };
}


const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stable);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, stable(entry)]));
};

const byKey = (key: string) => (a: unknown, b: unknown): number => String(fields(a)[key]).localeCompare(String(fields(b)[key]));

// A ruleset as compared: the fields the file sets, rules and status checks in
// a fixed order, nothing the API adds (ids, source, timestamps).
function canonicalRuleset(ruleset: Record<string, unknown>): unknown {
  const rules = (Array.isArray(ruleset.rules) ? ruleset.rules : []).map((rule) => {
    const { type, parameters } = fields(rule);
    if (parameters === undefined) return { type };
    const checks = fields(parameters).required_status_checks;
    return { type, parameters: Array.isArray(checks) ? { ...fields(parameters), required_status_checks: [...checks].sort(byKey('context')) } : parameters };
  });
  return stable({
    ...pick(ruleset, ['name', 'target', 'enforcement', 'conditions']),
    bypass_actors: [...(Array.isArray(ruleset.bypass_actors) ? ruleset.bypass_actors : [])].sort(byKey('actor_id')),
    rules: rules.sort(byKey('type')),
  });
}

const toggle = (path: string, on: boolean) => ({ method: on ? 'PUT' : 'DELETE', path }) as const;

export function diff(desired: DesiredState, live: LiveState): Item[] {
  const base = `/repos/${desired.repository}`;
  const items: Item[] = [];

  for (const [key, want] of Object.entries(desired.settings)) {
    const have = live.repo[key];
    items.push(same(have, want)
      ? item('repo', key, want, have, 'ok')
      : item('repo', key, want, have, 'drift', [{ method: 'PATCH', path: base, body: { [key]: want } }]));
  }

  const analysis = fields(live.repo.security_and_analysis);
  for (const key of ['secret_scanning', 'secret_scanning_push_protection', 'dependabot_security_updates'] as const) {
    const want = desired.security[key];
    const have = fields(analysis[key]).status;
    items.push(have === undefined
      ? item('security', key, want, null, 'unavailable', [], 'not exposed for this repository')
      : have === want
        ? item('security', key, want, have, 'ok')
        : item('security', key, want, have, 'drift', [{ method: 'PATCH', path: base, body: { security_and_analysis: { [key]: { status: want } } } }]));
  }
  for (const [key, have, path] of [
    ['vulnerability_alerts', live.vulnerabilityAlerts, `${base}/vulnerability-alerts`],
    ['private_vulnerability_reporting', live.privateReporting, `${base}/private-vulnerability-reporting`],
  ] as const) {
    const want = desired.security[key];
    items.push(have === want ? item('security', key, want, have, 'ok') : item('security', key, want, have, 'drift', [toggle(path, want)]));
  }

  const permissions = { allowed_actions: desired.actions.allowed_actions, sha_pinning_required: desired.actions.sha_pinning_required };
  const permissionsNow = pick(live.permissions, Object.keys(permissions));
  items.push(same(permissionsNow, permissions)
    ? item('actions', 'permissions', permissions, permissionsNow, 'ok')
    : item('actions', 'permissions', permissions, permissionsNow, 'drift',
        [{ method: 'PUT', path: `${base}/actions/permissions`, body: { enabled: true, ...permissions } }], `differs: ${changedKeys(permissions, permissionsNow).join(', ')}`));

  const workflow = { default_workflow_permissions: desired.actions.default_workflow_permissions, can_approve_pull_request_reviews: desired.actions.can_approve_pull_request_reviews };
  const workflowNow = pick(live.workflow, Object.keys(workflow));
  items.push(same(workflowNow, workflow)
    ? item('actions', 'workflow token', workflow, workflowNow, 'ok')
    : item('actions', 'workflow token', workflow, workflowNow, 'drift',
        [{ method: 'PUT', path: `${base}/actions/permissions/workflow`, body: workflow }], `differs: ${changedKeys(workflow, workflowNow).join(', ')}`));

  for (const [name, value] of Object.entries(desired.variables)) {
    const have = live.variables[name];
    items.push(have === value
      ? item('variables', name, value, have, 'ok')
      : item('variables', name, value, have, 'drift',
          [have === undefined ? { method: 'POST', path: `${base}/actions/variables`, body: { name, value } } : { method: 'PATCH', path: `${base}/actions/variables/${name}`, body: { name, value } }]));
  }

  const name = `ruleset ${desired.ruleset.name}`;
  if (!live.ruleset) {
    items.push(item('ruleset', name, 'present', null, 'drift', [{ method: 'POST', path: `${base}/rulesets`, body: desired.ruleset }]));
  } else {
    const want = canonicalRuleset({ ...desired.ruleset });
    const have = canonicalRuleset(live.ruleset);
    items.push(same(want, have)
      ? item('ruleset', name, 'as in repo.json', 'as in repo.json', 'ok')
      : item('ruleset', name, 'as in repo.json', `differs: ${changedKeys(fields(want), fields(have)).join(', ')}`, 'drift',
          [{ method: 'PUT', path: `${base}/rulesets/${live.ruleset.id}`, body: desired.ruleset }]));
  }
  return items;
}

export const apply = (client: Client, items: Item[], { log = () => {} }: { log?: (call: string) => void } = {}): Promise<string[]> =>
  applySteps(items, { log, call: async (step) => void (await client.request(step.method, step.path, step.body)) });

export const createRun = (desired: DesiredState, client: Client): Run => ({
  target: desired.repository,
  source: '.github/repo.json',
  survey: async () => diff(desired, await readLive(client, desired)),
  apply: (items, log) => apply(client, items, { log }),
});
