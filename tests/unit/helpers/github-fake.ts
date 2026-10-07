// In-memory GitHub REST fake seeded from tests/fixtures/github/live-drifted.json. Writes mutate
// state and every call is recorded; an unknown route fails the test.

import { API_BASE } from '../../../bin/lib/github-settings.ts';

type Fields = Record<string, unknown>;

export interface FakeState {
  repo: Fields;
  vulnerabilityAlerts: boolean;
  privateReporting: boolean;
  permissions: Fields;
  workflow: Fields;
  rulesets: (Fields & { id: number; name: string })[];
}

export interface RecordedCall {
  method: string;
  path: string;
  body: unknown;
  authorization: string | null;
}

const REPO = '/repos/joeseverino/jseverino.com';

export function createGithubFake(seed: FakeState, token: string) {
  const state = structuredClone(seed);
  const calls: RecordedCall[] = [];
  let nextId = 900;

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const empty = (status = 204) => new Response(null, { status });
  const notFound = () => json({ message: 'Not Found' }, 404);
  const ruleset = (id: string) => state.rulesets.find((entry) => String(entry.id) === id);
  const merge = (target: Fields, body: Fields) => {
    for (const [key, value] of Object.entries(body)) {
      const current = target[key];
      target[key] = typeof value === 'object' && value !== null && typeof current === 'object' && current !== null ? merge(current as Fields, value as Fields) : value;
    }
    return target;
  };
  const toggle = (flag: 'vulnerabilityAlerts' | 'privateReporting', on: boolean) => {
    state[flag] = on;
    return empty();
  };

  const routes: [string, RegExp, (id: string, body: Fields) => Response][] = [
    ['GET', /^$/, () => json(state.repo)],
    ['PATCH', /^$/, (_id, body) => json(merge(state.repo, body))],
    ['GET', /^\/vulnerability-alerts$/, () => (state.vulnerabilityAlerts ? empty() : notFound())],
    ['PUT', /^\/vulnerability-alerts$/, () => toggle('vulnerabilityAlerts', true)],
    ['DELETE', /^\/vulnerability-alerts$/, () => toggle('vulnerabilityAlerts', false)],
    ['GET', /^\/private-vulnerability-reporting$/, () => json({ enabled: state.privateReporting })],
    ['PUT', /^\/private-vulnerability-reporting$/, () => toggle('privateReporting', true)],
    ['DELETE', /^\/private-vulnerability-reporting$/, () => toggle('privateReporting', false)],
    ['GET', /^\/actions\/permissions$/, () => json(state.permissions)],
    ['PUT', /^\/actions\/permissions$/, (_id, body) => (Object.assign(state.permissions, body), empty())],
    ['GET', /^\/actions\/permissions\/workflow$/, () => json(state.workflow)],
    ['PUT', /^\/actions\/permissions\/workflow$/, (_id, body) => (Object.assign(state.workflow, body), empty())],
    ['GET', /^\/rulesets$/, () => json(state.rulesets.map(({ id, name }) => ({ id, name })))],
    ['POST', /^\/rulesets$/, (_id, body) => {
      const created = { id: nextId++, ...body } as Fields & { id: number; name: string };
      state.rulesets.push(created);
      return json(created, 201);
    }],
    ['GET', /^\/rulesets\/(\d+)$/, (id) => json(ruleset(id) ?? { message: 'Not Found' }, ruleset(id) ? 200 : 404)],
    ['PUT', /^\/rulesets\/(\d+)$/, (id, body) => {
      const index = state.rulesets.findIndex((entry) => String(entry.id) === id);
      if (index === -1) return notFound();
      state.rulesets[index] = { id: Number(id), ...body } as Fields & { id: number; name: string };
      return json(state.rulesets[index]);
    }],
  ];

  async function fetch(input: RequestInfo | URL, init: RequestInit = {}) {
    const href = input instanceof Request ? input.url : String(input);
    if (!href.startsWith(API_BASE)) throw new Error(`unexpected host: ${new URL(href).origin}`);
    const path = new URL(href).pathname;
    const method = init.method ?? 'GET';
    const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const authorization = new Headers(init.headers).get('authorization');
    calls.push({ method, path, body, authorization });
    if (authorization !== `Bearer ${token}`) return json({ message: 'Bad credentials' }, 401);
    if (path !== REPO && !path.startsWith(`${REPO}/`)) throw new Error(`the fake has no route for ${method} ${path}`);
    const rest = path.slice(REPO.length);
    for (const [verb, pattern, handle] of routes) {
      const match = verb === method ? rest.match(pattern) : null;
      if (match) return handle(match[1] ?? '', (body ?? {}) as Fields);
    }
    throw new Error(`the fake has no route for ${method} ${path}`);
  }

  const writes = () => calls.filter((call) => call.method !== 'GET');
  return { fetch, calls, writes, state };
}
