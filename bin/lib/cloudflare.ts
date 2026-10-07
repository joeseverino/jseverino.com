// Cloudflare desired state (cloudflare/zone.json) against the live zone and account. bin/cloudflare.ts is the CLI.
// Paths are templates (`:zone`, `:account`, mid-apply ids) so output never prints an id. Rules this repo
// owns carry a ref starting with `<owner>-`; every other rule is read and never written.
import { setTimeout as sleep } from 'node:timers/promises';
import type {
  AccessApp, AccessPolicy, ApiErrorEntry, ApiPayload, ApiSchema, DesiredState, FirewallRuleSpec, LiveRule, LiveState,
  Operation, OwnedRule, PagesProject, Rule, Ruleset, RulesList, Setting, ValidationSettings, Widget, Zone,
} from './cloudflare-types.ts';
import { applySteps, changedKeys, fields, item, loadDesired as load, pick, same, type Call, type Fetch, type Item, type Method, type Run, type Step } from './drift.ts';

export type * from './cloudflare-types.ts';

export const API_BASE = 'https://api.cloudflare.com/client/v4';

const FIREWALL_PHASE = 'http_request_firewall_custom';
const RATELIMIT_PHASE = 'http_ratelimit';
const REDIRECT_PHASE = 'http_request_redirect';

export class ApiError extends Error {
  status: number;

  constructor(method: string, template: string, status: number, errors: ApiErrorEntry[] = []) {
    const detail = errors.map((error) => `${error.code ?? ''} ${error.message ?? ''}`.trim()).join('; ');
    super(`${method} ${template} → ${status}${detail ? ` (${detail})` : ''}`);
    this.status = status;
  }
}

export const loadDesired = (file: string, schemaFile: string): DesiredState => load<DesiredState>(file, schemaFile);

export interface ClientOptions {
  token: string | undefined;
  fetch?: Fetch;
  wait?: (ms: number) => Promise<unknown>;
}

export type Client = ReturnType<typeof createClient>;

// The token only ever goes into the Authorization header; nothing here
// formats a request's headers into output.
export function createClient({ token, fetch = globalThis.fetch, wait = sleep }: ClientOptions) {
  if (!token) throw new Error('CLOUDFLARE_API_TOKEN is not set');
  const ids: Record<string, string> = {};
  const resolve = (template: string) =>
    template.replace(/:([a-z]+)/g, (_, name: string) => {
      const id = ids[name];
      if (id === undefined) throw new Error(`${template}: no ${name} id resolved yet`);
      return encodeURIComponent(id);
    });

  // Response bodies are trusted to carry the documented v4 shape; nothing validates them.
  async function request<T>(method: Method, template: string, body?: unknown): Promise<ApiPayload<T>> {
    const response = await fetch(`${API_BASE}${resolve(template)}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload: ApiPayload<T> = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) throw new ApiError(method, template, response.status, payload.errors);
    return payload;
  }

  return {
    ids,
    wait,
    request,
    get: async <T>(template: string): Promise<T> => (await request<T>('GET', template)).result as T,
    // A missing ruleset entrypoint (or setting) answers 404, which reads as absent.
    maybe: async <T>(template: string): Promise<T | null> => {
      try {
        return (await request<T>('GET', template)).result as T;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    async list<T>(template: string): Promise<T[]> {
      const results: T[] = [];
      for (let page = 1; ; page += 1) {
        const separator = template.includes('?') ? '&' : '?';
        const payload = await request<T[]>('GET', `${template}${separator}page=${page}&per_page=50`);
        results.push(...(payload.result ?? []));
        const info = payload.result_info;
        if (!info || page >= (info.total_pages ?? 1) || (payload.result ?? []).length < 50) return results;
      }
    },
  };
}

const q = (value: string): string => encodeURIComponent(value);

export async function readLive(client: Client, desired: DesiredState): Promise<LiveState> {
  const [zone] = await client.get<Zone[]>(`/zones?name=${q(desired.zone)}`);
  if (!zone) throw new Error(`the token cannot see a zone named ${desired.zone}`);
  client.ids.zone = zone.id;
  client.ids.account = zone.account.id;

  const settings: LiveState['settings'] = Object.fromEntries((await client.get<Setting[]>('/zones/:zone/settings')).map((setting) => [setting.id, setting]));
  for (const id of [...Object.keys(desired.settings), 'security_header']) {
    if (!settings[id]) settings[id] = await client.maybe<Setting>(`/zones/:zone/settings/${id}`);
  }

  const sv = desired.schemaValidation;
  const operations = await client.list<Operation>(
    `/zones/:zone/api_gateway/operations?host=${q(sv.host)}&method=${q(sv.method)}&endpoint=${q(sv.endpoint)}`,
  );
  const operation = operations.find((op) => op.host === sv.host && op.method === sv.method && op.endpoint === sv.endpoint) ?? null;

  const lists = await client.get<RulesList[]>('/accounts/:account/rules/lists');
  const list = lists.find((entry) => entry.name === desired.pagesDevRedirect.list) ?? null;

  return {
    settings,
    dnssec: await client.get<LiveState['dnssec']>('/zones/:zone/dnssec'),
    firewall: await client.maybe<Ruleset>(`/zones/:zone/rulesets/phases/${FIREWALL_PHASE}/entrypoint`),
    ratelimit: await client.maybe<Ruleset>(`/zones/:zone/rulesets/phases/${RATELIMIT_PHASE}/entrypoint`),
    redirect: await client.maybe<Ruleset>(`/accounts/:account/rulesets/phases/${REDIRECT_PHASE}/entrypoint`),
    botManagement: await client.maybe<Record<string, unknown>>('/zones/:zone/bot_management'),
    list,
    listItems: list ? await client.get<LiveState['listItems']>(`/accounts/:account/rules/lists/${q(list.id)}/items`) : [],
    project: await client.maybe<PagesProject>(`/accounts/:account/pages/projects/${q(desired.pages.project)}`),
    accessApps: await client.list<AccessApp>('/accounts/:account/access/apps'),
    schemas: await client.get<ApiSchema[]>('/zones/:zone/schema_validation/schemas?omit_source=false'),
    validationSettings: await client.get<ValidationSettings>('/zones/:zone/schema_validation/settings'),
    operation,
    operationSettings: operation
      ? await client.maybe<{ mitigation_action?: string }>(`/zones/:zone/schema_validation/settings/operations/${q(operation.operation_id)}`)
      : null,
    widgets: await client.list<Widget>('/accounts/:account/challenges/widgets'),
  };
}


const ownedRef = (desired: DesiredState, id: string): string => `${desired.owner}-${id}`;
const isOwned = <R extends Rule>(desired: DesiredState, rule: R): rule is R & OwnedRule => typeof rule.ref === 'string' && rule.ref.startsWith(`${desired.owner}-`);
const describe = (desired: DesiredState, text: string): string => `[${desired.owner}] ${text}`;

function firewallRule(desired: DesiredState, rule: FirewallRuleSpec): OwnedRule {
  return {
    ref: ownedRef(desired, rule.id),
    description: describe(desired, rule.description),
    expression: rule.expression,
    action: rule.action,
    enabled: true,
  };
}

function rateLimitRule(desired: DesiredState): OwnedRule {
  const rule = desired.rateLimit;
  return {
    ref: ownedRef(desired, rule.id),
    description: describe(desired, rule.description),
    expression: rule.expression,
    action: rule.action,
    ratelimit: {
      characteristics: rule.characteristics,
      period: rule.period,
      requests_per_period: rule.requests_per_period,
      mitigation_timeout: rule.mitigation_timeout,
    },
    enabled: true,
  };
}

function redirectRule(desired: DesiredState): OwnedRule {
  const name = desired.pagesDevRedirect.list;
  return {
    ref: ownedRef(desired, 'pages-dev-redirect'),
    description: describe(desired, `Close the production pages.dev alias (list ${name})`),
    expression: `http.request.full_uri in $${name}`,
    action: 'redirect',
    action_parameters: { from_list: { name, key: 'http.request.full_uri' } },
    enabled: true,
  };
}

// The fields a rule is compared on: what this file sets, nothing the API adds.
const RULE_FIELDS = ['description', 'expression', 'action', 'enabled', 'ratelimit', 'action_parameters'] as const;
const ruleView = (rule: Rule): Record<string, unknown> =>
  Object.fromEntries(
    RULE_FIELDS
      .filter((key) => rule[key] !== undefined)
      .map((key) => [key, key === 'ratelimit' ? pick(rule.ratelimit, ['characteristics', 'period', 'requests_per_period', 'mitigation_timeout']) : rule[key]]),
  );

// One phase entrypoint: create, update, or delete the owned rules; leave the
// rest. A missing entrypoint is created whole, which is safe because nothing
// else lives in it yet.
function rulesetItems(desired: DesiredState, area: string, scope: 'zones' | 'accounts', phase: string, live: Ruleset | null, wanted: OwnedRule[]): Item[] {
  const base = `/${scope}/:${scope === 'zones' ? 'zone' : 'account'}/rulesets`;
  if (!live) {
    return wanted.map((rule, index) =>
      item(area, rule.ref, 'present', null, 'drift', index === 0
        ? [{ method: 'PUT', path: `${base}/phases/${phase}/entrypoint`, body: { rules: wanted } }]
        : [], index === 0 ? '' : 'created with the entrypoint'));
  }
  const rules = live.rules ?? [];
  const items: Item[] = [];
  for (const rule of wanted) {
    const current = rules.find((entry) => entry.ref === rule.ref);
    if (!current) {
      items.push(item(area, rule.ref, 'present', null, 'drift', [{ method: 'POST', path: `${base}/${q(live.id)}/rules`, body: rule }]));
    } else if (!same(ruleView(current), ruleView(rule))) {
      items.push(item(area, rule.ref, 'as in zone.json', `differs: ${changedKeys(ruleView(rule), ruleView(current)).join(', ')}`, 'drift', [{ method: 'PATCH', path: `${base}/${q(live.id)}/rules/${q(current.id)}`, body: rule }]));
    } else {
      items.push(item(area, rule.ref, 'present', 'present', 'ok'));
    }
  }
  const wantedRefs = new Set(wanted.map((rule) => rule.ref));
  for (const rule of rules.filter((entry): entry is LiveRule & OwnedRule => isOwned(desired, entry) && !wantedRefs.has(entry.ref))) {
    items.push(item(area, rule.ref, null, 'present', 'drift', [{ method: 'DELETE', path: `${base}/${q(live.id)}/rules/${q(rule.id)}` }], 'owned rule no longer in zone.json'));
  }
  const unowned = rules.filter((entry) => !isOwned(desired, entry)).length;
  if (unowned > 0) items.push(item(area, 'unowned rules', 'left alone', `${unowned}`, 'ok', [], 'never edited or deleted'));
  return items;
}

function settingsItems(desired: DesiredState, live: LiveState): Item[] {
  const items: Item[] = [];
  for (const [id, want] of Object.entries(desired.settings)) {
    const setting = live.settings[id];
    if (!setting) {
      items.push(item('setting', id, want, null, 'unavailable', [], 'not exposed for this zone'));
    } else if (same(setting.value, want)) {
      items.push(item('setting', id, want, setting.value, 'ok'));
    } else if (setting.editable === false) {
      items.push(item('setting', id, want, setting.value, 'manual', [], 'not editable on this plan'));
    } else {
      items.push(item('setting', id, want, setting.value, 'drift', [{ method: 'PATCH', path: `/zones/:zone/settings/${id}`, body: { value: want } }]));
    }
  }

  const header = fields(fields(fields(live.settings.security_header).value).strict_transport_security);
  const want = desired.hsts;
  const have = pick(header, Object.keys(want));
  const hsts = (value: Record<string, unknown>) => Object.entries(value).map(([key, setting]) => (setting === true ? key : setting === false ? `no ${key}` : `${key} ${setting}`)).join(', ') || null;
  items.push(same(have, want)
    ? item('setting', 'hsts', hsts(want), hsts(have), 'ok')
    : item('setting', 'hsts', hsts(want), hsts(have), 'drift', [{
        method: 'PATCH',
        path: '/zones/:zone/settings/security_header',
        body: { value: { strict_transport_security: { ...header, ...want } } },
      }]));
  return items;
}

// The writable fields apply carries over from the live zone, so a PUT that
// sets the declared ones does not reset the rest to their defaults.
const BOT_MANAGEMENT_KEPT = ['ai_bots_protection', 'content_bots_protection', 'crawler_protection'] as const;

function botManagementItem(desired: DesiredState, live: LiveState): Item {
  const want = desired.botManagement;
  if (!live.botManagement) return item('bot-management', 'bot_management', want, null, 'unavailable', [], 'not exposed for this zone');
  const have = pick(live.botManagement, Object.keys(want));
  if (same(have, want)) return item('bot-management', 'bot_management', want, have, 'ok');
  const body = { ...pick(live.botManagement, BOT_MANAGEMENT_KEPT), ...want };
  return item('bot-management', 'bot_management', want, have, 'drift', [{ method: 'PUT', path: '/zones/:zone/bot_management', body }],
    `differs: ${changedKeys(want, have).join(', ')}`);
}

function dnssecItem(desired: DesiredState, live: LiveState): Item {
  const have = live.dnssec?.status;
  if (have === desired.dnssec) return item('dnssec', 'status', desired.dnssec, have, 'ok');
  if (have === 'pending') return item('dnssec', 'status', desired.dnssec, have, 'manual', [], 'waiting for the DS record at the registrar');
  return item('dnssec', 'status', desired.dnssec, have, 'drift', [{ method: 'PATCH', path: '/zones/:zone/dnssec', body: { status: desired.dnssec } }],
    desired.dnssec === 'active' ? 'then publish the DS record at the registrar unless it is Cloudflare' : '');
}

function redirectItems(desired: DesiredState, live: LiveState): Item[] {
  const want = desired.pagesDevRedirect;
  const entry = pick(want, ['source_url', 'target_url', 'status_code', 'preserve_query_string', 'subpath_matching', 'preserve_path_suffix', 'include_subdomains']);
  const items: Item[] = [];
  const putItems: Call = { method: 'PUT', path: '/accounts/:account/rules/lists/:list/items', body: [{ redirect: entry }], awaitBulk: true };

  if (!live.list) {
    items.push(item('redirect', `list ${want.list}`, 'redirect list', null, 'drift', [
      { method: 'POST', path: '/accounts/:account/rules/lists', body: { name: want.list, kind: 'redirect', description: describe(desired, 'pages.dev alias redirect') }, saveAs: { list: 'id' } },
      putItems,
    ]));
  } else {
    const current = live.listItems.map((row) => pick(row.redirect, Object.keys(entry)));
    const steps: Step[] = [{ use: { list: live.list.id } }, putItems];
    items.push(live.list.kind !== 'redirect'
      ? item('redirect', `list ${want.list}`, 'redirect list', `${live.list.kind} list`, 'manual', [], 'a list of another kind holds the name')
      : current.length === 1 && same(current[0], entry)
        ? item('redirect', `list ${want.list}`, entry, current[0], 'ok')
        : item('redirect', `list ${want.list}`, entry, current, 'drift', steps));
  }
  items.push(...rulesetItems(desired, 'redirect', 'accounts', REDIRECT_PHASE, live.redirect, [redirectRule(desired)]));
  return items;
}

function pagesItems(desired: DesiredState, live: LiveState, compatibilityDate: string): Item[] {
  const project = desired.pages.project;
  if (!live.project) return [item('pages', project, 'project', null, 'manual', [], 'create the Pages project with Git integration')];
  const configs = live.project.deployment_configs ?? {};
  const have = { production: configs.production?.compatibility_date, preview: configs.preview?.compatibility_date };
  const want = { production: compatibilityDate, preview: compatibilityDate };
  const items = [same(have, want)
    ? item('pages', 'compatibility_date', want, have, 'ok')
    : item('pages', 'compatibility_date', want, have, 'drift', [{
        method: 'PATCH',
        path: `/accounts/:account/pages/projects/${q(project)}`,
        body: { deployment_configs: { production: { compatibility_date: compatibilityDate }, preview: { compatibility_date: compatibilityDate } } },
      }], 'the edge suite runs this date (tests/browser-test-env.ts)')];

  const previews = `*.${project}.pages.dev`;
  const apps = live.accessApps.filter((app) => app.domain === previews || (app.self_hosted_domains ?? []).includes(previews)
    || (app.destinations ?? []).some((destination) => destination.uri === previews));
  const covered = apps.length > 0;
  items.push(covered === desired.pages.previewAccess
    ? item('pages', 'preview access', desired.pages.previewAccess, covered, 'ok')
    : item('pages', 'preview access', desired.pages.previewAccess, covered, 'manual', [],
        'Pages project → Settings → General → Enable access policy'));
  if (covered) items.push(previewPolicyItem(apps));
  return items;
}

const SERVICE_TOKEN_RULES = new Set(['service_token', 'any_valid_service_token']);

// A policy that admits only service tokens: Service Auth, every include rule a token.
const isServiceAuthOnly = (policy: AccessPolicy): boolean =>
  policy.decision === 'non_identity' && (policy.include ?? []).length > 0
  && (policy.include ?? []).every((rule) => Object.keys(rule).length > 0 && Object.keys(rule).every((key) => SERVICE_TOKEN_RULES.has(key)));

// Previews are reached only by CI's service token and the tailnet proxy's.
// Any other policy (an email, a group, everyone) is reported; apply never
// edits Access, so a person fixes it in the dashboard.
function previewPolicyItem(apps: AccessApp[]): Item {
  const policies = apps.flatMap((app) => app.policies ?? []);
  const human = policies.filter((policy) => !isServiceAuthOnly(policy));
  const describePolicy = (policy: AccessPolicy) => `${policy.name ?? 'unnamed'} (${policy.decision ?? 'no decision'})`;
  if (policies.length > 0 && human.length === 0) return item('pages', 'preview access policy', 'service-auth-only', 'service-auth-only', 'ok');
  return item('pages', 'preview access policy', 'service-auth-only', policies.length ? human.map(describePolicy).join(', ') : 'no policies', 'manual', [],
    'Zero Trust → Access → Applications → the preview app: keep only Service Auth policies that include the CI and proxy service tokens');
}

function canonicalJson(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return null;
  }
}

function schemaValidationItems(desired: DesiredState, live: LiveState, openapi: string): Item[] {
  const sv = desired.schemaValidation;
  const items: Item[] = [];
  const named = live.schemas.filter((schema) => schema.name === sv.name);
  const current = named.find((schema) => canonicalJson(schema.source) === canonicalJson(openapi));
  if (!current) {
    items.push(item('api-shield', `schema ${sv.name}`, sv.file, named.length ? 'stale source' : null, 'drift', [
      { method: 'POST', path: '/zones/:zone/schema_validation/schemas', body: { kind: 'openapi_v3', name: sv.name, source: openapi, validation_enabled: true } },
      ...named.map((schema): Call => ({ method: 'DELETE', path: `/zones/:zone/schema_validation/schemas/${q(schema.schema_id)}` })),
    ]));
  } else if (!current.validation_enabled) {
    items.push(item('api-shield', `schema ${sv.name}`, 'enabled', 'disabled', 'drift', [
      { method: 'PATCH', path: `/zones/:zone/schema_validation/schemas/${q(current.schema_id)}`, body: { validation_enabled: true } },
    ]));
  } else {
    const extra = named.filter((schema) => schema !== current);
    items.push(extra.length
      ? item('api-shield', `schema ${sv.name}`, 'one copy', `${named.length} copies`, 'drift',
          extra.map((schema): Call => ({ method: 'DELETE', path: `/zones/:zone/schema_validation/schemas/${q(schema.schema_id)}` })))
      : item('api-shield', `schema ${sv.name}`, sv.file, sv.file, 'ok'));
  }

  const name = `${sv.method} ${sv.host}${sv.endpoint}`;
  const setAction: Call = { method: 'PUT', path: '/zones/:zone/schema_validation/settings/operations/:operation', body: { mitigation_action: sv.action } };
  if (!live.operation) {
    items.push(item('api-shield', name, sv.action, null, 'drift', [
      { method: 'POST', path: '/zones/:zone/api_gateway/operations/item', body: { method: sv.method, host: sv.host, endpoint: sv.endpoint }, saveAs: { operation: 'operation_id' } },
      setAction,
    ]));
  } else {
    const have = live.operationSettings?.mitigation_action ?? null;
    items.push(have === sv.action
      ? item('api-shield', name, sv.action, have, 'ok')
      : item('api-shield', name, sv.action, have, 'drift', [{ use: { operation: live.operation.operation_id } }, setAction]));
  }

  const override = live.validationSettings?.validation_override_mitigation_action ?? null;
  items.push(override === 'none'
    ? item('api-shield', 'zone override', 'unset', override, 'drift', [{
        method: 'PUT',
        path: '/zones/:zone/schema_validation/settings',
        body: { validation_default_mitigation_action: live.validationSettings?.validation_default_mitigation_action, validation_override_mitigation_action: null },
      }], 'an override of none switches every operation off')
    : item('api-shield', 'zone override', 'unset', override ?? 'unset', 'ok'));
  return items;
}

function turnstileItem(desired: DesiredState, live: LiveState): Item {
  const want = desired.turnstile.domains;
  const widgets = live.widgets.filter((widget) => (widget.domains ?? []).some((domain) => want.includes(domain)));
  const [widget] = widgets;
  if (!widget || widgets.length !== 1) {
    return item('turnstile', 'widget', want, widgets.length ? `${widgets.length} widgets` : null, 'manual', [],
      widgets.length ? 'more than one widget names these hostnames' : 'no widget names these hostnames');
  }
  const have = [...(widget.domains ?? [])].sort();
  if (same(have, want.toSorted())) return item('turnstile', 'domains', want, have, 'ok');
  const body = { ...pick(widget, ['name', 'mode', 'bot_fight_mode', 'clearance_level', 'ephemeral_id', 'offlabel', 'region']), domains: want };
  return item('turnstile', 'domains', want, have, 'drift', [
    { use: { sitekey: widget.sitekey } },
    { method: 'PUT', path: '/accounts/:account/challenges/widgets/:sitekey', body },
  ]);
}

export function diff(desired: DesiredState, live: LiveState, { openapi, compatibilityDate }: { openapi: string; compatibilityDate: string }): Item[] {
  return [
    ...settingsItems(desired, live),
    botManagementItem(desired, live),
    dnssecItem(desired, live),
    ...rulesetItems(desired, 'waf', 'zones', FIREWALL_PHASE, live.firewall, desired.firewall.map((rule) => firewallRule(desired, rule))),
    ...rulesetItems(desired, 'ratelimit', 'zones', RATELIMIT_PHASE, live.ratelimit, [rateLimitRule(desired)]),
    ...redirectItems(desired, live),
    ...pagesItems(desired, live, compatibilityDate),
    ...schemaValidationItems(desired, live, openapi),
    turnstileItem(desired, live),
  ];
}

async function awaitBulk(client: Client, operationId: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const operation = await client.get<{ status: string; error?: string }>(`/accounts/:account/rules/lists/bulk_operations/${q(operationId)}`);
    if (operation.status === 'completed') return;
    if (operation.status === 'failed') throw new Error(`list bulk operation failed: ${operation.error ?? 'no detail'}`);
    await client.wait(1000);
  }
  throw new Error('list bulk operation did not complete in 30 s');
}

export function apply(client: Client, items: Item[], { log = () => {} }: { log?: (call: string) => void } = {}): Promise<string[]> {
  return applySteps(items, {
    use: (ids) => Object.assign(client.ids, ids),
    log,
    async call(step) {
      const result = fields((await client.request<object>(step.method, step.path, step.body)).result);
      for (const [name, field] of Object.entries(step.saveAs ?? {})) client.ids[name] = String(result[field]);
      if (step.awaitBulk) await awaitBulk(client, String(result.operation_id));
    },
  });
}

export const createRun = (desired: DesiredState, client: Client, context: { openapi: string; compatibilityDate: string }): Run => ({
  target: desired.zone,
  source: 'cloudflare/zone.json',
  survey: async () => diff(desired, await readLive(client, desired), context),
  apply: (items, log) => apply(client, items, { log }),
});
