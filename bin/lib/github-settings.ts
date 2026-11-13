// The GitHub repository posture in .github/repo.json against the live repository.
// bin/github.ts is the CLI; the check / plan / apply flow is bin/lib/drift.ts.
import { applySteps, changedKeys, fields, type Item, item, loadDesired as load, pick, type Run, type Step, same } from './drift.ts';
import type { Client } from './github.ts';
import { absentOn404 } from './rest.ts';

interface RulesetSpec {
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
    description: string;
    homepage: string;
  };
  topics: string[];
  security: {
    secret_scanning: Status;
    secret_scanning_push_protection: Status;
    dependabot_security_updates: Status;
    vulnerability_alerts: boolean;
    private_vulnerability_reporting: boolean;
    immutable_releases: boolean;
    code_scanning: { state: 'configured' | 'not-configured'; languages: string[] };
  };
  actions: {
    allowed_actions: 'all' | 'local_only' | 'selected';
    sha_pinning_required: boolean;
    default_workflow_permissions: 'read' | 'write';
    can_approve_pull_request_reviews: boolean;
  };
  variables: Record<string, string>;
  rulesets: RulesetSpec[];
}

export interface LiveState {
  repo: Record<string, unknown>;
  vulnerabilityAlerts: boolean;
  privateReporting: boolean;
  immutableReleases: boolean;
  codeScanning: Record<string, unknown>;
  permissions: Record<string, unknown>;
  workflow: Record<string, unknown>;
  variables: Record<string, string>;
  // Each declared ruleset's live copy, by name; a name with none is missing.
  rulesets: Map<string, Record<string, unknown> & { id: number }>;
}

export const loadDesired = (file: string, schemaFile: string): DesiredState => load<DesiredState>(file, schemaFile);

async function readLive(client: Client, desired: DesiredState): Promise<LiveState> {
  const base = `/repos/${desired.repository}`;
  const listed = await client.get<{ id: number; name: string }[]>(`${base}/rulesets`);
  const declared = new Set(desired.rulesets.map((ruleset) => ruleset.name));
  return {
    repo: await client.get<Record<string, unknown>>(base),
    vulnerabilityAlerts: await client.isOn(`${base}/vulnerability-alerts`),
    privateReporting: Boolean(fields(await client.get(`${base}/private-vulnerability-reporting`)).enabled),
    // GitHub documents a 404 when off; the live API answers 200 with enabled false.
    immutableReleases: Boolean(fields(await absentOn404(client.get(`${base}/immutable-releases`))).enabled),
    codeScanning: await client.get<Record<string, unknown>>(`${base}/code-scanning/default-setup`),
    permissions: await client.get<Record<string, unknown>>(`${base}/actions/permissions`),
    workflow: await client.get<Record<string, unknown>>(`${base}/actions/permissions/workflow`),
    variables: Object.fromEntries(
      (await client.get<{ variables: { name: string; value: string }[] }>(`${base}/actions/variables?per_page=100`)).variables.map(({ name, value }) => [
        name,
        value,
      ]),
    ),
    rulesets: new Map(
      await Promise.all(
        listed
          .filter((entry) => declared.has(entry.name))
          .map(async ({ id, name }) => [name, await client.get<Record<string, unknown> & { id: number }>(`${base}/rulesets/${id}`)] as const),
      ),
    ),
  };
}

const byKey =
  (key: string) =>
  (a: unknown, b: unknown): number =>
    String(fields(a)[key]).localeCompare(String(fields(b)[key]));

// A ruleset as compared: the fields the file sets, rules and status checks in
// a fixed order, nothing the API adds (ids, source, timestamps).
function canonicalRuleset(ruleset: Record<string, unknown>): unknown {
  const rules = (Array.isArray(ruleset.rules) ? ruleset.rules : []).map((rule) => {
    const { type, parameters } = fields(rule);
    if (parameters === undefined) return { type };
    const checks = fields(parameters).required_status_checks;
    return { type, parameters: Array.isArray(checks) ? { ...fields(parameters), required_status_checks: [...checks].sort(byKey('context')) } : parameters };
  });
  return {
    ...pick(ruleset, ['name', 'target', 'enforcement', 'conditions']),
    bypass_actors: [...(Array.isArray(ruleset.bypass_actors) ? ruleset.bypass_actors : [])].sort(byKey('actor_id')),
    rules: rules.sort(byKey('type')),
  };
}

const toggle = (path: string, on: boolean) => ({ method: on ? 'PUT' : 'DELETE', path }) as const;

// A setting compared whole as an object; a drift names the keys that differ and takes one step.
function objectItem(area: string, name: string, want: Record<string, unknown>, have: Record<string, unknown>, step: Step): Item {
  return same(want, have)
    ? item(area, name, want, have, 'ok')
    : item(area, name, want, have, 'drift', [step], `differs: ${changedKeys(want, have).join(', ')}`);
}

function repoItems(desired: DesiredState, live: LiveState, base: string): Item[] {
  const items = Object.entries(desired.settings).map(([key, want]) => {
    const have = live.repo[key];
    return same(have, want)
      ? item('repo', key, want, have, 'ok')
      : item('repo', key, want, have, 'drift', [{ method: 'PATCH', path: base, body: { [key]: want } }]);
  });
  const topics = [...desired.topics].sort();
  const topicsNow = (Array.isArray(live.repo.topics) ? live.repo.topics.map(String) : []).sort();
  items.push(
    same(topics, topicsNow)
      ? item('repo', 'topics', topics, topicsNow, 'ok')
      : item('repo', 'topics', topics, topicsNow, 'drift', [{ method: 'PUT', path: `${base}/topics`, body: { names: topics } }]),
  );
  return items;
}

function securityItems(desired: DesiredState, live: LiveState, base: string): Item[] {
  const analysis = fields(live.repo.security_and_analysis);
  const items = (['secret_scanning', 'secret_scanning_push_protection', 'dependabot_security_updates'] as const).map((key) => {
    const want = desired.security[key];
    const have = fields(analysis[key]).status;
    if (have === undefined) return item('security', key, want, null, 'unavailable', [], 'not exposed for this repository');
    return have === want
      ? item('security', key, want, have, 'ok')
      : item('security', key, want, have, 'drift', [{ method: 'PATCH', path: base, body: { security_and_analysis: { [key]: { status: want } } } }]);
  });
  for (const [key, have, path] of [
    ['vulnerability_alerts', live.vulnerabilityAlerts, `${base}/vulnerability-alerts`],
    ['private_vulnerability_reporting', live.privateReporting, `${base}/private-vulnerability-reporting`],
    ['immutable_releases', live.immutableReleases, `${base}/immutable-releases`],
  ] as const) {
    const want = desired.security[key];
    items.push(have === want ? item('security', key, want, have, 'ok') : item('security', key, want, have, 'drift', [toggle(path, want)]));
  }

  // CodeQL default setup, ahead of the ruleset: its code_scanning rule waits on
  // CodeQL results, so the analysis is on before the rule is.
  const scanning = { state: desired.security.code_scanning.state, languages: desired.security.code_scanning.languages.toSorted() };
  const scanningNow = {
    state: live.codeScanning.state,
    languages: (Array.isArray(live.codeScanning.languages) ? live.codeScanning.languages.map(String) : []).sort(),
  };
  items.push(objectItem('security', 'code_scanning', scanning, scanningNow, { method: 'PATCH', path: `${base}/code-scanning/default-setup`, body: scanning }));
  return items;
}

function actionsItems(desired: DesiredState, live: LiveState, base: string): Item[] {
  const permissions = { allowed_actions: desired.actions.allowed_actions, sha_pinning_required: desired.actions.sha_pinning_required };
  const workflow = {
    default_workflow_permissions: desired.actions.default_workflow_permissions,
    can_approve_pull_request_reviews: desired.actions.can_approve_pull_request_reviews,
  };
  const items = [
    objectItem('actions', 'permissions', permissions, pick(live.permissions, Object.keys(permissions)), {
      method: 'PUT',
      path: `${base}/actions/permissions`,
      body: { enabled: true, ...permissions },
    }),
    objectItem('actions', 'workflow token', workflow, pick(live.workflow, Object.keys(workflow)), {
      method: 'PUT',
      path: `${base}/actions/permissions/workflow`,
      body: workflow,
    }),
  ];
  for (const [name, value] of Object.entries(desired.variables)) {
    const have = live.variables[name];
    items.push(
      have === value
        ? item('variables', name, value, have, 'ok')
        : item('variables', name, value, have, 'drift', [
            have === undefined
              ? { method: 'POST', path: `${base}/actions/variables`, body: { name, value } }
              : { method: 'PATCH', path: `${base}/actions/variables/${name}`, body: { name, value } },
          ]),
    );
  }
  return items;
}

function rulesetItem(desired: RulesetSpec, live: LiveState, base: string): Item {
  const name = `ruleset ${desired.name}`;
  const found = live.rulesets.get(desired.name);
  if (!found) return item('ruleset', name, 'present', null, 'drift', [{ method: 'POST', path: `${base}/rulesets`, body: desired }]);
  const want = canonicalRuleset({ ...desired });
  const have = canonicalRuleset(found);
  return same(want, have)
    ? item('ruleset', name, 'as in repo.json', 'as in repo.json', 'ok')
    : item('ruleset', name, 'as in repo.json', `differs: ${changedKeys(fields(want), fields(have)).join(', ')}`, 'drift', [
        { method: 'PUT', path: `${base}/rulesets/${found.id}`, body: desired },
      ]);
}

function diff(desired: DesiredState, live: LiveState): Item[] {
  const base = `/repos/${desired.repository}`;
  return [
    ...repoItems(desired, live, base),
    ...securityItems(desired, live, base),
    ...actionsItems(desired, live, base),
    ...desired.rulesets.map((ruleset) => rulesetItem(ruleset, live, base)),
  ];
}

export const createRun = (desired: DesiredState, client: Client): Run => ({
  target: desired.repository,
  source: '.github/repo.json',
  survey: async () => diff(desired, await readLive(client, desired)),
  apply: (items, log) => applySteps(items, { log, call: async (step) => void (await client.request(step.method, step.path, step.body)) }),
});
