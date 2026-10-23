// In-memory GitHub REST fake seeded from tests/fixtures/github/live-drifted.json. Writes mutate
// state and every call is recorded; an unknown route fails the test.

import { API_BASE } from '../../../bin/lib/github.ts';
import { callRecorder } from './desired-state.ts';

type Fields = Record<string, unknown>;

export interface FakeState {
  repo: Fields;
  vulnerabilityAlerts: boolean;
  privateReporting: boolean;
  codeScanning: Fields;
  permissions: Fields;
  workflow: Fields;
  variables: { name: string; value: string }[];
  rulesets: (Fields & { id: number; name: string })[];
}

const REPO = '/repos/joeseverino/jseverino.com';

export function createGithubFake(seed: FakeState, token: string) {
  const state = structuredClone(seed);
  const { calls, record, writes } = callRecorder(API_BASE, token);
  let nextId = 900;

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const empty = (status = 204) => new Response(null, { status });
  const notFound = () => json({ message: 'Not Found' }, 404);
  const ruleset = (id: string) => state.rulesets.find((entry) => String(entry.id) === id);
  const toggle = (flag: 'vulnerabilityAlerts' | 'privateReporting', on: boolean) => {
    state[flag] = on;
    return empty();
  };

  const routes: [string, RegExp, (id: string, body: Fields, version: string) => Response][] = [
    ['GET', /^$/, () => json(state.repo)],
    ['PATCH', /^$/, (_id, body) => {
      const { security_and_analysis: analysis, ...fields } = body;
      Object.assign(state.repo, fields);
      if (analysis) state.repo.security_and_analysis = { ...(state.repo.security_and_analysis as Fields), ...(analysis as Fields) };
      return json(state.repo);
    }],
    ['PUT', /^\/topics$/, (_id, body) => (state.repo.topics = body.names, json({ names: body.names }))],
    ['GET', /^\/vulnerability-alerts$/, () => (state.vulnerabilityAlerts ? empty() : notFound())],
    ['PUT', /^\/vulnerability-alerts$/, () => toggle('vulnerabilityAlerts', true)],
    ['DELETE', /^\/vulnerability-alerts$/, () => toggle('vulnerabilityAlerts', false)],
    ['GET', /^\/private-vulnerability-reporting$/, () => json({ enabled: state.privateReporting })],
    ['PUT', /^\/private-vulnerability-reporting$/, () => toggle('privateReporting', true)],
    ['DELETE', /^\/private-vulnerability-reporting$/, () => toggle('privateReporting', false)],
    // API versions before 2026-03-10 also list javascript-typescript as its single-language aliases.
    ['GET', /^\/code-scanning\/default-setup$/, (_id, _body, version) => {
      const languages = (state.codeScanning.languages as string[]).flatMap((language) =>
        language === 'javascript-typescript' && version < '2026-03-10' ? ['javascript', language, 'typescript'] : [language]);
      return json({ ...state.codeScanning, languages });
    }],
    // Enabling queues a first analysis: 202 with the run.
    ['PATCH', /^\/code-scanning\/default-setup$/, (_id, body) => (Object.assign(state.codeScanning, body), json({ run_id: 42, run_url: `${API_BASE}${REPO}/actions/runs/42` }, 202))],
    ['GET', /^\/actions\/permissions$/, () => json(state.permissions)],
    ['PUT', /^\/actions\/permissions$/, (_id, body) => (Object.assign(state.permissions, body), empty())],
    ['GET', /^\/actions\/permissions\/workflow$/, () => json(state.workflow)],
    ['PUT', /^\/actions\/permissions\/workflow$/, (_id, body) => (Object.assign(state.workflow, body), empty())],
    ['GET', /^\/actions\/variables$/, () => json({ total_count: state.variables.length, variables: state.variables })],
    ['POST', /^\/actions\/variables$/, (_id, body) => (state.variables.push(body as { name: string; value: string }), empty(201))],
    ['PATCH', /^\/actions\/variables\/([A-Z_]+)$/, (name, body) => {
      const found = state.variables.find((entry) => entry.name === name);
      if (!found) return notFound();
      Object.assign(found, body);
      return empty();
    }],
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
    const { path, method, body, authorized } = record(input, init);
    if (!authorized) return json({ message: 'Bad credentials' }, 401);
    if (path !== REPO && !path.startsWith(`${REPO}/`)) throw new Error(`the fake has no route for ${method} ${path}`);
    const rest = path.slice(REPO.length);
    for (const [verb, pattern, handle] of routes) {
      const match = verb === method ? rest.match(pattern) : null;
      if (match) return handle(match[1] ?? '', (body ?? {}) as Fields, new Headers(init.headers).get('X-GitHub-Api-Version') ?? '');
    }
    throw new Error(`the fake has no route for ${method} ${path}`);
  }

  return { fetch, calls, writes, state };
}
