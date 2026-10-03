// An in-memory stand-in for the Cloudflare v4 endpoints bin/lib/cloudflare.ts
// uses, seeded from a fixture of API-shaped live state. Writes mutate the
// state, so an apply can be re-checked and re-applied against it. Every call
// is recorded; an unknown route fails the test instead of passing silently.

import {
  API_BASE,
  type AccessApp, type ApiSchema, type LiveRule, type Operation, type Rule, type RulesList, type ValidationSettings, type Widget,
} from '../../../bin/lib/cloudflare.ts';

type Fields = Record<string, unknown>;

// tests/fixtures/cloudflare/live-drifted.json: API-shaped state, stored the
// way the fake serves it (settings by id, rulesets by scope/phase, list items
// inside their list).
export interface FakeState {
  zone: { id: string; name: string; account: { id: string } };
  settings: Record<string, { value: unknown; editable?: boolean }>;
  dnssec: Fields;
  rulesets: Record<string, { id: string; phase?: string; rules: LiveRule[] }>;
  lists: (RulesList & { items: Fields[] })[];
  project: { name: string; deployment_configs: Record<string, Fields> };
  accessApps: AccessApp[];
  schemas: ApiSchema[];
  validationSettings: ValidationSettings;
  operations: Operation[];
  operationSettings: Record<string, Fields>;
  widgets: Widget[];
}

export interface RecordedCall {
  method: string;
  path: string;
  body: unknown;
  authorization: string | null;
}

// Capture groups, in order; every route's pattern defines the ones it reads.
type Groups = [string, string];
type Handler = (groups: Groups, url: URL, body: unknown) => Response;

// The fake trusts each route's request body to have the shape the client sends.
const route = <B = unknown>(method: string, pattern: RegExp, handle: (groups: Groups, url: URL, body: B) => Response): [string, RegExp, Handler] =>
  [method, pattern, (groups, url, body) => handle(groups, url, body as B)];

export function createCloudflareFake(seed: FakeState, token: string) {
  const state = structuredClone(seed);
  const calls: RecordedCall[] = [];
  let next = 1;
  const newId = (prefix: string) => `${prefix}-new-${next++}`;

  const ok = (result: unknown, extra: Fields = {}) => new Response(JSON.stringify({ success: true, errors: [], result, ...extra }), { status: 200 });
  const fail = (status: number, message: string) =>
    new Response(JSON.stringify({ success: false, errors: [{ code: status, message }], result: null }), { status });
  const page = (items: unknown[], url: URL) => {
    const number = Number(url.searchParams.get('page') ?? 1);
    const size = Number(url.searchParams.get('per_page') ?? 50);
    return ok(items.slice((number - 1) * size, number * size), {
      result_info: { page: number, per_page: size, total_pages: Math.max(1, Math.ceil(items.length / size)), count: items.length },
    });
  };
  const setting = (id: string) => state.settings[id] && { id, ...state.settings[id] };

  function ruleset(scope: string, phase: string) {
    return state.rulesets[`${scope}/${phase}`];
  }
  function rulesetById(id: string) {
    return Object.values(state.rulesets).find((entry) => entry.id === id);
  }
  const list = (id: string) => {
    const found = state.lists.find((entry) => entry.id === id);
    if (!found) throw new Error(`the fake has no list ${id}`);
    return found;
  };

  const routes: [string, RegExp, Handler][] = [
    route('GET', /^\/zones$/, (_g, url) => ok(url.searchParams.get('name') === state.zone.name ? [state.zone] : [])),
    route('GET', /^\/zones\/zone-0001\/settings$/, () => ok(Object.keys(state.settings).map(setting))),
    route('GET', /^\/zones\/zone-0001\/settings\/([^/]+)$/, ([id]) => setting(id) ? ok(setting(id)) : fail(404, 'Invalid setting')),
    route<{ value: unknown }>('PATCH', /^\/zones\/zone-0001\/settings\/([^/]+)$/, ([id], _u, body) => {
      const current = state.settings[id];
      if (!current) return fail(404, 'Invalid setting');
      current.value = body.value;
      return ok(setting(id));
    }),
    route('GET', /^\/zones\/zone-0001\/dnssec$/, () => ok(state.dnssec)),
    route<Fields>('PATCH', /^\/zones\/zone-0001\/dnssec$/, (_g, _u, body) => ok(Object.assign(state.dnssec, body))),
    route('GET', /^\/(zones|accounts)\/[^/]+\/rulesets\/phases\/([^/]+)\/entrypoint$/, ([scope, phase]) =>
      ruleset(scope, phase) ? ok(ruleset(scope, phase)) : fail(404, 'could not find entrypoint ruleset')),
    route<{ rules: Rule[] }>('PUT', /^\/(zones|accounts)\/[^/]+\/rulesets\/phases\/([^/]+)\/entrypoint$/, ([scope, phase], _u, body) => {
      const created = { id: newId('ruleset'), phase, rules: body.rules.map((rule) => ({ id: newId('rule'), ...rule })) };
      state.rulesets[`${scope}/${phase}`] = created;
      return ok(created);
    }),
    route<Rule>('POST', /^\/(?:zones|accounts)\/[^/]+\/rulesets\/([^/]+)\/rules$/, ([id], _u, body) => {
      const target = rulesetById(id);
      if (!target) return fail(404, 'no ruleset');
      target.rules.push({ id: newId('rule'), ...body });
      return ok(target);
    }),
    route<Rule>('PATCH', /^\/(?:zones|accounts)\/[^/]+\/rulesets\/([^/]+)\/rules\/([^/]+)$/, ([id, ruleId], _u, body) => {
      const target = rulesetById(id);
      const index = target?.rules.findIndex((entry) => entry.id === ruleId) ?? -1;
      if (!target || index === -1) return fail(404, 'no rule');
      target.rules[index] = { id: ruleId, ...body };
      return ok(target);
    }),
    route('DELETE', /^\/(?:zones|accounts)\/[^/]+\/rulesets\/([^/]+)\/rules\/([^/]+)$/, ([id, ruleId]) => {
      const target = rulesetById(id);
      if (!target) return fail(404, 'no ruleset');
      target.rules = target.rules.filter((entry) => entry.id !== ruleId);
      return ok(target);
    }),
    route('GET', /^\/accounts\/account-0001\/rules\/lists$/, () => ok(state.lists.map(({ items, ...entry }) => ({ ...entry, num_items: items.length })))),
    route<{ name: string; kind: string }>('POST', /^\/accounts\/account-0001\/rules\/lists$/, (_g, _u, body) => {
      const created = { id: newId('list'), ...body, items: [] };
      state.lists.push(created);
      return ok({ id: created.id, name: created.name, kind: created.kind });
    }),
    route('GET', /^\/accounts\/account-0001\/rules\/lists\/bulk_operations\/([^/]+)$/, ([id]) => ok({ id, status: 'completed' })),
    route('GET', /^\/accounts\/account-0001\/rules\/lists\/([^/]+)\/items$/, ([id]) => ok(list(id).items)),
    route<Fields[]>('PUT', /^\/accounts\/account-0001\/rules\/lists\/([^/]+)\/items$/, ([id], _u, body) => {
      list(id).items = body.map((entry) => ({ id: newId('item'), ...entry }));
      return ok({ operation_id: newId('op') });
    }),
    route('GET', /^\/accounts\/account-0001\/pages\/projects\/([^/]+)$/, ([name]) => name === state.project.name ? ok(state.project) : fail(404, 'Project not found')),
    route<{ deployment_configs?: Record<string, Fields> }>('PATCH', /^\/accounts\/account-0001\/pages\/projects\/([^/]+)$/, (_g, _u, body) => {
      for (const [env, config] of Object.entries(body.deployment_configs ?? {})) {
        state.project.deployment_configs[env] = { ...state.project.deployment_configs[env], ...config };
      }
      return ok(state.project);
    }),
    route('GET', /^\/accounts\/account-0001\/access\/apps$/, (_g, url) => page(state.accessApps, url)),
    route('GET', /^\/zones\/zone-0001\/schema_validation\/schemas$/, () => ok(state.schemas)),
    route<Omit<ApiSchema, 'schema_id'>>('POST', /^\/zones\/zone-0001\/schema_validation\/schemas$/, (_g, _u, body) => {
      const schema = { schema_id: newId('schema'), ...body };
      state.schemas.push(schema);
      return ok(schema);
    }),
    route<Partial<ApiSchema>>('PATCH', /^\/zones\/zone-0001\/schema_validation\/schemas\/([^/]+)$/, ([id], _u, body) => {
      const schema = state.schemas.find((entry) => entry.schema_id === id);
      return schema ? ok(Object.assign(schema, body)) : fail(404, 'no schema');
    }),
    route('DELETE', /^\/zones\/zone-0001\/schema_validation\/schemas\/([^/]+)$/, ([id]) => {
      state.schemas = state.schemas.filter((schema) => schema.schema_id !== id);
      return ok({ schema_id: id });
    }),
    route('GET', /^\/zones\/zone-0001\/schema_validation\/settings$/, () => ok(state.validationSettings)),
    route<ValidationSettings>('PUT', /^\/zones\/zone-0001\/schema_validation\/settings$/, (_g, _u, body) => ok(Object.assign(state.validationSettings, body))),
    route('GET', /^\/zones\/zone-0001\/schema_validation\/settings\/operations\/([^/]+)$/, ([id]) =>
      state.operationSettings[id] ? ok({ operation_id: id, ...state.operationSettings[id] }) : fail(404, 'no operation settings')),
    route<Fields>('PUT', /^\/zones\/zone-0001\/schema_validation\/settings\/operations\/([^/]+)$/, ([id], _u, body) => {
      state.operationSettings[id] = body;
      return ok({ operation_id: id, ...body });
    }),
    route('GET', /^\/zones\/zone-0001\/api_gateway\/operations$/, (_g, url) => page(state.operations, url)),
    route<Omit<Operation, 'operation_id'>>('POST', /^\/zones\/zone-0001\/api_gateway\/operations\/item$/, (_g, _u, body) => {
      const operation = { operation_id: newId('op'), ...body };
      state.operations.push(operation);
      return ok(operation);
    }),
    route('GET', /^\/accounts\/account-0001\/challenges\/widgets$/, (_g, url) => page(state.widgets, url)),
    route<Fields>('PUT', /^\/accounts\/account-0001\/challenges\/widgets\/([^/]+)$/, ([sitekey], _u, body) => {
      const widget = state.widgets.find((entry) => entry.sitekey === sitekey);
      return widget ? ok(Object.assign(widget, body)) : fail(404, 'no widget');
    }),
  ];

  async function fetch(input: RequestInfo | URL, init: RequestInit = {}) {
    const href = input instanceof Request ? input.url : String(input);
    const url = new URL(href);
    if (!href.startsWith(API_BASE)) throw new Error(`unexpected host: ${url.origin}`);
    const path = url.pathname.slice(new URL(API_BASE).pathname.length);
    const method = init.method ?? 'GET';
    const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const authorization = new Headers(init.headers).get('authorization');
    calls.push({ method, path: `${path}${url.search}`, body, authorization });
    if (authorization !== `Bearer ${token}`) return fail(403, 'Authentication error');
    for (const [verb, pattern, handle] of routes) {
      const match = verb === method ? path.match(pattern) : null;
      if (match) return handle(match.slice(1) as Groups, url, body);
    }
    throw new Error(`the fake has no route for ${method} ${path}`);
  }

  const writes = () => calls.filter((call) => call.method !== 'GET');
  return { fetch, calls, writes, state };
}
