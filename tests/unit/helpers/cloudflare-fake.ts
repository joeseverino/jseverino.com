// In-memory Cloudflare v4 fake seeded from an API-shaped fixture. Writes mutate state and every
// call is recorded; an unknown route fails the test.

import {
  type AccessApp,
  API_BASE,
  type ApiSchema,
  type LiveRule,
  type Operation,
  type Rule,
  type ValidationSettings,
  type Widget,
} from '../../../bin/lib/cloudflare.ts';
import { callRecorder } from './desired-state.ts';

type Fields = Record<string, unknown>;

// tests/fixtures/cloudflare/live-drifted.json: state stored the way the fake serves it.
export interface FakeState {
  zone: { id: string; name: string; account: { id: string } };
  settings: Record<string, { value: unknown; editable?: boolean }>;
  dnssec: Fields;
  botManagement: Fields;
  rulesets: Record<string, { id: string; phase?: string; rules: LiveRule[] }>;
  accessApps: AccessApp[];
  schemas: ApiSchema[];
  validationSettings: ValidationSettings;
  operations: Operation[];
  operationSettings: Record<string, Fields>;
  widgets: Widget[];
}

type Groups = [string, string];
type Handler = (groups: Groups, url: URL, body: unknown) => Response;

// The fake trusts each route's request body to have the shape the client sends.
const route = <B = unknown>(method: string, pattern: RegExp, handle: (groups: Groups, url: URL, body: B) => Response): [string, RegExp, Handler] => [
  method,
  pattern,
  (groups, url, body) => handle(groups, url, body as B),
];

export function createCloudflareFake(seed: FakeState, token: string) {
  const state = structuredClone(seed);
  const { calls, record, writes } = callRecorder(API_BASE, token);
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

  const ruleset = (phase: string) => state.rulesets[`zones/${phase}`];
  const rulesetById = (id: string) => Object.values(state.rulesets).find((entry) => entry.id === id);
  const routes: [string, RegExp, Handler][] = [
    route('GET', /^\/zones$/, (_g, url) => ok(url.searchParams.get('name') === state.zone.name ? [state.zone] : [])),
    route('GET', /^\/zones\/zone-0001\/settings$/, () => ok(Object.keys(state.settings).map(setting))),
    route('GET', /^\/zones\/zone-0001\/settings\/([^/]+)$/, ([id]) => (setting(id) ? ok(setting(id)) : fail(404, 'Invalid setting'))),
    route<{ value: unknown }>('PATCH', /^\/zones\/zone-0001\/settings\/([^/]+)$/, ([id], _u, body) => {
      const current = state.settings[id];
      if (!current) return fail(404, 'Invalid setting');
      current.value = body.value;
      return ok(setting(id));
    }),
    route('GET', /^\/zones\/zone-0001\/bot_management$/, () => ok(state.botManagement)),
    // The real endpoint resets every field a PUT leaves out.
    route<Fields>('PUT', /^\/zones\/zone-0001\/bot_management$/, (_g, _u, body) => {
      state.botManagement = {
        using_latest_model: state.botManagement.using_latest_model,
        ai_bots_protection: 'disabled',
        content_bots_protection: 'disabled',
        crawler_protection: 'disabled',
        ai_training: 'disabled',
        ai_search: 'disabled',
        ai_user: 'disabled',
        ...body,
      };
      return ok(state.botManagement);
    }),
    route('GET', /^\/zones\/zone-0001\/dnssec$/, () => ok(state.dnssec)),
    route<Fields>('PATCH', /^\/zones\/zone-0001\/dnssec$/, (_g, _u, body) => ok(Object.assign(state.dnssec, body))),
    route('GET', /^\/zones\/zone-0001\/rulesets\/phases\/([^/]+)\/entrypoint$/, ([phase]) =>
      ruleset(phase) ? ok(ruleset(phase)) : fail(404, 'could not find entrypoint ruleset'),
    ),
    route<{ rules: Rule[] }>('PUT', /^\/zones\/zone-0001\/rulesets\/phases\/([^/]+)\/entrypoint$/, ([phase], _u, body) => {
      const created = { id: newId('ruleset'), phase, rules: body.rules.map((rule) => ({ id: newId('rule'), ...rule })) };
      state.rulesets[`zones/${phase}`] = created;
      return ok(created);
    }),
    route<Rule>('POST', /^\/zones\/zone-0001\/rulesets\/([^/]+)\/rules$/, ([id], _u, body) => {
      const target = rulesetById(id);
      if (!target) return fail(404, 'no ruleset');
      target.rules.push({ id: newId('rule'), ...body });
      return ok(target);
    }),
    route<Rule>('PATCH', /^\/zones\/zone-0001\/rulesets\/([^/]+)\/rules\/([^/]+)$/, ([id, ruleId], _u, body) => {
      const target = rulesetById(id);
      const index = target?.rules.findIndex((entry) => entry.id === ruleId) ?? -1;
      if (!target || index === -1) return fail(404, 'no rule');
      target.rules[index] = { id: ruleId, ...body };
      return ok(target);
    }),
    route('DELETE', /^\/zones\/zone-0001\/rulesets\/([^/]+)\/rules\/([^/]+)$/, ([id, ruleId]) => {
      const target = rulesetById(id);
      if (!target) return fail(404, 'no ruleset');
      target.rules = target.rules.filter((entry) => entry.id !== ruleId);
      return ok(target);
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
      state.operationSettings[id] ? ok({ operation_id: id, ...state.operationSettings[id] }) : fail(404, 'no operation settings'),
    ),
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
    const { url, path, method, body, authorized } = record(input, init);
    if (!authorized) return fail(403, 'Authentication error');
    for (const [verb, pattern, handle] of routes) {
      const match = verb === method ? path.match(pattern) : null;
      if (match) return handle(match.slice(1) as Groups, url, body);
    }
    throw new Error(`the fake has no route for ${method} ${path}`);
  }

  return { fetch, calls, writes, state };
}
