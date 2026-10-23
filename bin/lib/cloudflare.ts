// Cloudflare desired state (cloudflare/zone.json) against the live zone and account. bin/cloudflare.ts is the CLI.
// Paths are templates (`:zone`, `:account`, mid-apply ids) so output never prints an id. Rules this repo
// owns carry a ref starting with `<owner>-`; every other rule is read and never written.
import type {
  AccessApp, AccessPolicy, ApiErrorEntry, ApiPayload, ApiSchema, DesiredState, FirewallRuleSpec, LiveRule, LiveState,
  Operation, OwnedRule, Rule, Ruleset, Setting, ValidationSettings, Widget, Zone,
} from './cloudflare-types.ts';
import dns from 'node:dns';
import { canonicalJsonText } from '../../src/lib/canonical-json.ts';
import { PREVIEW_HOST_SUFFIX } from '../../src/lib/site-config.ts';
import { applySteps, changedKeys, fields, item, loadDesired as load, pick, same, type Call, type Fetch, type Item, type Method, type Run } from './drift.ts';

export type * from './cloudflare-types.ts';

export const API_BASE = 'https://api.cloudflare.com/client/v4';

const FIREWALL_PHASE = 'http_request_firewall_custom';
// Custom rules allowed in the phase, dashboard rules included.
const FIREWALL_LIMIT = 5;
const RATELIMIT_PHASE = 'http_ratelimit';

class ApiError extends Error {
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
}

export type Client = ReturnType<typeof createClient>;

// The token only ever goes into the Authorization header; nothing here
// formats a request's headers into output.
export function createClient({ token, fetch = globalThis.fetch }: ClientOptions) {
  if (!token) throw new Error('CLOUDFLARE_API_TOKEN is not set');
  // A token's client IP filter lists IPv4 addresses, and Node's fetch tries the first address
  // dns.lookup returns, which is IPv6 on a dual-stack network unless this order says otherwise.
  dns.setDefaultResultOrder('ipv4first');
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

async function readLive(client: Client, desired: DesiredState): Promise<LiveState> {
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

  return {
    settings,
    dnssec: await client.get<LiveState['dnssec']>('/zones/:zone/dnssec'),
    firewall: await client.maybe<Ruleset>(`/zones/:zone/rulesets/phases/${FIREWALL_PHASE}/entrypoint`),
    ratelimit: await client.maybe<Ruleset>(`/zones/:zone/rulesets/phases/${RATELIMIT_PHASE}/entrypoint`),
    botManagement: await client.maybe<Record<string, unknown>>('/zones/:zone/bot_management'),
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
    ...firewallRule(desired, rule),
    ratelimit: {
      characteristics: rule.characteristics,
      period: rule.period,
      requests_per_period: rule.requests_per_period,
      mitigation_timeout: rule.mitigation_timeout,
    },
  };
}

// The fields a rule is compared on: what this file sets, nothing the API adds.
const RULE_FIELDS = ['description', 'expression', 'action', 'enabled', 'ratelimit'] as const;
const ruleView = (rule: Rule): Record<string, unknown> =>
  Object.fromEntries(
    RULE_FIELDS
      .filter((key) => rule[key] !== undefined)
      .map((key) => [key, key === 'ratelimit' ? pick(rule.ratelimit, ['characteristics', 'period', 'requests_per_period', 'mitigation_timeout']) : rule[key]]),
  );

// One phase entrypoint: create, update, or delete the owned rules; leave the
// rest. A missing entrypoint is created whole, which is safe because nothing
// else lives in it yet.
function rulesetItems(desired: DesiredState, area: string, phase: string, live: Ruleset | null, wanted: OwnedRule[]): Item[] {
  const base = '/zones/:zone/rulesets';
  if (!live) {
    return wanted.map((rule, index) =>
      item(area, rule.ref, 'present', null, 'drift', index === 0
        ? [{ method: 'PUT', path: `${base}/phases/${phase}/entrypoint`, body: { rules: wanted } }]
        : [], index === 0 ? '' : 'created with the entrypoint'));
  }
  const rules = live.rules ?? [];
  const items: Item[] = [];
  // Deletes come first so a plan at the phase's rule limit frees a slot before it needs one.
  const wantedRefs = new Set(wanted.map((rule) => rule.ref));
  for (const rule of rules.filter((entry): entry is LiveRule & OwnedRule => isOwned(desired, entry) && !wantedRefs.has(entry.ref))) {
    items.push(item(area, rule.ref, null, 'present', 'drift', [{ method: 'DELETE', path: `${base}/${q(live.id)}/rules/${q(rule.id)}` }], 'owned rule no longer in zone.json'));
  }
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

// Dashboard rules count against the limit, so the total is checked, not just this file's share.
function firewallBudgetItem(desired: DesiredState, live: LiveState): Item {
  const others = (live.firewall?.rules ?? []).filter((rule) => !isOwned(desired, rule)).length;
  const total = others + desired.firewall.length;
  return item('waf', 'rule budget', `at most ${FIREWALL_LIMIT}`, `${total} after apply`, total > FIREWALL_LIMIT ? 'manual' : 'ok', [],
    total > FIREWALL_LIMIT ? `${others} dashboard rules plus ${desired.firewall.length} in zone.json; remove one` : '');
}

function dnssecItem(desired: DesiredState, live: LiveState): Item {
  const have = live.dnssec?.status;
  if (have === desired.dnssec) return item('dnssec', 'status', desired.dnssec, have, 'ok');
  if (have === 'pending') return item('dnssec', 'status', desired.dnssec, have, 'manual', [], 'waiting for the DS record at the registrar');
  return item('dnssec', 'status', desired.dnssec, have, 'drift', [{ method: 'PATCH', path: '/zones/:zone/dnssec', body: { status: desired.dnssec } }],
    desired.dnssec === 'active' ? 'then publish the DS record at the registrar unless it is Cloudflare' : '');
}

const SERVICE_TOKEN_RULES = new Set(['service_token', 'any_valid_service_token']);

// A policy that admits only service tokens: Service Auth, every include rule a token.
const isServiceAuthOnly = (policy: AccessPolicy): boolean =>
  policy.decision === 'non_identity' && (policy.include ?? []).length > 0
  && (policy.include ?? []).every((rule) => Object.keys(rule).length > 0 && Object.keys(rule).every((key) => SERVICE_TOKEN_RULES.has(key)));

// Every Worker preview answers on <label><PREVIEW_HOST_SUFFIX>, so one Access
// application on the wildcard covers them all.
const PREVIEW_HOSTS = `*${PREVIEW_HOST_SUFFIX}`;
const coversPreviews = (app: AccessApp): boolean => app.domain === PREVIEW_HOSTS
  || (app.self_hosted_domains ?? []).includes(PREVIEW_HOSTS)
  || (app.destinations ?? []).some((destination) => destination.uri === PREVIEW_HOSTS);

// Previews are reached only by CI's service token and the tailnet proxy's.
// A missing application, or any other policy (an email, a group, everyone),
// is reported; apply never edits Access, so a person fixes it in the dashboard.
function previewAccessItem(desired: DesiredState, live: LiveState): Item {
  const want = desired.preview.accessPolicy;
  const apps = live.accessApps.filter(coversPreviews);
  if (apps.length === 0) {
    return item('preview', 'access policy', want, null, 'manual', [],
      `Zero Trust → Access → Applications: add a self-hosted application for ${PREVIEW_HOSTS} with a Service Auth policy`);
  }
  const policies = apps.flatMap((app) => app.policies ?? []);
  const human = policies.filter((policy) => !isServiceAuthOnly(policy));
  const describePolicy = (policy: AccessPolicy) => `${policy.name ?? 'unnamed'} (${policy.decision ?? 'no decision'})`;
  if (policies.length > 0 && human.length === 0) return item('preview', 'access policy', want, 'service-auth-only', 'ok');
  return item('preview', 'access policy', want, policies.length ? human.map(describePolicy).join(', ') : 'no policies', 'manual', [],
    `Zero Trust → Access → Applications → ${PREVIEW_HOSTS}: keep only Service Auth policies that include the CI and proxy service tokens`);
}

function schemaValidationItems(desired: DesiredState, live: LiveState, openapi: string): Item[] {
  const sv = desired.schemaValidation;
  const items: Item[] = [];
  const named = live.schemas.filter((schema) => schema.name === sv.name);
  const wanted = canonicalJsonText(openapi);
  const current = named.find((schema) => canonicalJsonText(schema.source) === wanted);
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

function diff(desired: DesiredState, live: LiveState, openapi: string): Item[] {
  return [
    ...settingsItems(desired, live),
    botManagementItem(desired, live),
    dnssecItem(desired, live),
    ...rulesetItems(desired, 'waf', FIREWALL_PHASE, live.firewall, desired.firewall.map((rule) => firewallRule(desired, rule))),
    firewallBudgetItem(desired, live),
    ...rulesetItems(desired, 'ratelimit', RATELIMIT_PHASE, live.ratelimit, [rateLimitRule(desired)]),
    previewAccessItem(desired, live),
    ...schemaValidationItems(desired, live, openapi),
    turnstileItem(desired, live),
  ];
}

// A field a later step depends on; a response without it must not become the id "undefined".
function required(result: Record<string, unknown>, field: string, step: Call): string {
  const value = result[field];
  if (value === undefined || value === null || value === '') throw new Error(`${step.method} ${step.path}: response has no ${field}`);
  return String(value);
}

export const createRun = (desired: DesiredState, client: Client, openapi: string): Run => ({
  target: desired.zone,
  source: 'cloudflare/zone.json',
  survey: async () => diff(desired, await readLive(client, desired), openapi),
  apply: (items, log) => applySteps(items, {
    use: (ids) => Object.assign(client.ids, ids),
    log,
    async call(step) {
      const result = fields((await client.request<object>(step.method, step.path, step.body)).result);
      for (const [name, field] of Object.entries(step.saveAs ?? {})) client.ids[name] = required(result, field, step);
    },
  }),
});
