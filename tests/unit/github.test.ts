import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { main } from '../../bin/github.ts';
import { API_BASE, createClient } from '../../bin/lib/github.ts';
import { type DesiredState, loadDesired } from '../../bin/lib/github-settings.ts';
import type { JsonSchema } from '../../bin/lib/json-schema.ts';
import { fromRoot } from '../../src/lib/site-root.ts';
import { read, runner, schemaTests } from './helpers/desired-state.ts';
import { createGithubFake, type FakeState } from './helpers/github-fake.ts';

const TOKEN = 'fixture-token-never-printed';
const seed = read<FakeState>('tests/fixtures/github/live-drifted.json');
const schema = read<JsonSchema>('.github/repo.schema.json');
const desired = read<DesiredState>('.github/repo.json');

// A field added to the type and not the schema (or the reverse) fails here.
const DESIRED_FIELDS = {
  $schema: true,
  repository: true,
  settings: true,
  topics: true,
  security: true,
  actions: true,
  variables: true,
  ruleset: true,
} satisfies Record<keyof DesiredState, true>;

const { run, checkJson, ...shared } = runner(main, (fake: ReturnType<typeof createGithubFake>) => ({ env: { GITHUB_TOKEN: TOKEN }, fetch: fake.fetch }));

const status = (report: { items: { name: string; status: string }[] }, name: string) => report.items.find((entry) => entry.name === name)?.status;

describe('.github/repo.json', () => {
  schemaTests({ desired, schema, fields: DESIRED_FIELDS, load: () => loadDesired(fromRoot('.github/repo.json'), fromRoot('.github/repo.schema.json')) });

  test('squash is the only merge method, in the settings and in the ruleset', () => {
    const { settings, ruleset } = desired;
    assert.deepEqual([settings.allow_squash_merge, settings.allow_merge_commit, settings.allow_rebase_merge], [true, false, false]);
    const pullRequest = ruleset.rules.find((rule) => rule.type === 'pull_request');
    assert.deepEqual(pullRequest?.parameters?.allowed_merge_methods, ['squash']);
  });

  test('the ruleset keeps signed commits required and the branch undeletable', () => {
    const types = desired.ruleset.rules.map((rule) => rule.type);
    for (const type of ['required_signatures', 'non_fast_forward', 'deletion']) assert.ok(types.includes(type), type);
  });

  test('CodeQL gates merges through default setup and the code_scanning rule, never a workflow check', () => {
    assert.equal(desired.security.code_scanning.state, 'configured');
    const scanning = desired.ruleset.rules.find((rule) => rule.type === 'code_scanning')?.parameters?.code_scanning_tools as { tool: string }[] | undefined;
    assert.ok(scanning?.some((entry) => entry.tool === 'CodeQL'));
    const gate = desired.ruleset.rules.find((rule) => rule.type === 'required_status_checks')?.parameters?.required_status_checks as { context: string }[];
    assert.ok(!gate.some((check) => /^analyze\b/i.test(check.context)), 'no required check is a CodeQL workflow job');
  });
});

describe('check', () => {
  test('reports drift item by item, ignores rule and check order, and exits 1', async () => {
    const fake = createGithubFake(seed, TOKEN);
    const { code, report } = await checkJson(fake);
    assert.equal(code, 1);
    assert.equal(status(report, 'allow_merge_commit'), 'drift');
    assert.equal(status(report, 'allow_squash_merge'), 'ok');
    assert.equal(status(report, 'description'), 'drift', 'the About text is held to repo.json');
    assert.equal(status(report, 'homepage'), 'ok');
    assert.equal(status(report, 'topics'), 'drift');
    assert.equal(status(report, 'secret_scanning_push_protection'), 'drift');
    assert.equal(status(report, 'private_vulnerability_reporting'), 'drift');
    assert.equal(status(report, 'vulnerability_alerts'), 'ok');
    assert.equal(status(report, 'code_scanning'), 'drift');
    assert.equal(status(report, 'permissions'), 'drift');
    assert.equal(status(report, 'workflow token'), 'ok');
    assert.equal(status(report, 'PUBLIC_TURNSTILE_SITE_KEY'), 'drift');
    assert.equal(status(report, 'ruleset main'), 'ok', 'the fixture lists the same rules and checks in another order');
    assert.equal(fake.writes().length, 0, 'check is read-only');
  });

  test('a ruleset missing a required check is drift', async () => {
    const trimmed = structuredClone(seed);
    const checks = trimmed.rulesets[0]?.rules as { type: string; parameters?: { required_status_checks: { context: string }[] } }[];
    const gate = checks.find((rule) => rule.type === 'required_status_checks')?.parameters;
    assert.ok(gate);
    gate.required_status_checks = gate.required_status_checks.filter((check) => check.context !== 'edge');
    const { report } = await checkJson(createGithubFake(trimmed, TOKEN));
    assert.equal(status(report, 'ruleset main'), 'drift');
  });

  test('sends the token only as a bearer header and never prints it', async () => {
    await shared.bearerOnly(createGithubFake(seed, TOKEN), TOKEN);
  });

  test('a missing token stops before any request', () => shared.missingTokenStops(createGithubFake(seed, TOKEN), /GITHUB_TOKEN/));
});

describe('plan', () => {
  test('lists the fixing calls and touches nothing', async () => {
    const lines = await shared.planLines(createGithubFake(seed, TOKEN));
    const repo = '/repos/joeseverino/jseverino.com';
    assert.deepEqual(lines.toSorted(), [
      `PATCH ${repo}`,
      `PATCH ${repo}`,
      `PATCH ${repo}`,
      `PATCH ${repo}/code-scanning/default-setup`,
      `POST ${repo}/actions/variables`,
      `PUT ${repo}/actions/permissions`,
      `PUT ${repo}/private-vulnerability-reporting`,
      `PUT ${repo}/topics`,
    ]);
  });

  test('apply without --yes is a plan', () => shared.applyWithoutYesIsAPlan(createGithubFake(seed, TOKEN)));
});

describe('apply --yes', () => {
  test('a missing ruleset is created whole', async () => {
    const fake = createGithubFake({ ...seed, rulesets: [] }, TOKEN);
    await run(fake, 'apply', '--yes');
    assert.equal(fake.writes().filter((call) => call.method === 'POST' && call.path.endsWith('/rulesets')).length, 1);
    assert.equal(fake.state.rulesets[0]?.name, desired.ruleset.name);
  });

  test('converges and re-applies as a no-op', async () => {
    const fake = createGithubFake(seed, TOKEN);
    const first = await run(fake, 'apply', '--yes');
    assert.equal(first.code, 0, first.output);
    assert.equal(fake.state.repo.allow_merge_commit, false);
    assert.match(String(fake.state.repo.description), /Hash-based CSP/);
    assert.deepEqual(fake.state.repo.topics, [...desired.topics]);
    assert.deepEqual((fake.state.repo.security_and_analysis as Record<string, unknown>).secret_scanning_push_protection, { status: 'enabled' });
    assert.equal(fake.state.privateReporting, true);
    assert.equal(fake.state.permissions.sha_pinning_required, true);
    assert.equal(fake.state.codeScanning.state, 'configured');
    assert.deepEqual(fake.state.codeScanning.languages, ['actions', 'javascript-typescript']);
    assert.deepEqual(
      fake.state.variables.map((entry) => entry.name).sort(),
      ['PUBLIC_TURNSTILE_SITE_KEY', 'UNRELATED'],
      'variables not in repo.json are left alone',
    );

    await shared.reapplyIsNoOp(fake);
  });

  test('one apply turns CodeQL default setup on before the ruleset that requires its results', async () => {
    const before = structuredClone(seed);
    const [live] = before.rulesets;
    assert.ok(live);
    const rules = live.rules as { type: string; parameters?: { required_status_checks?: { context: string; integration_id?: number }[] } }[];
    live.rules = rules.filter((rule) => rule.type !== 'code_scanning');
    rules
      .find((rule) => rule.type === 'required_status_checks')
      ?.parameters?.required_status_checks?.push({ context: 'analyze typescript', integration_id: 15368 });
    const fake = createGithubFake(before, TOKEN);
    const { code, output } = await run(fake, 'apply', '--yes');
    assert.equal(code, 0, output);
    const paths = fake.writes().map((call) => `${call.method} ${call.path}`);
    const setup = paths.findIndex((line) => line.endsWith('/code-scanning/default-setup'));
    const ruleset = paths.findIndex((line) => line.startsWith('PUT') && line.includes('/rulesets/'));
    assert.ok(setup !== -1 && ruleset !== -1 && setup < ruleset, paths.join('\n'));
  });

  test('a rejected token fails loudly without printing it', async () => {
    const fake = createGithubFake(seed, 'a-different-token');
    await assert.rejects(run(fake, 'apply', '--yes'), (error: Error) => {
      assert.match(error.message, /GET \/repos\/joeseverino\/jseverino\.com\/rulesets → 401/);
      assert.ok(!error.message.includes(TOKEN));
      return true;
    });
  });
});

describe('the GitHub client', () => {
  test('follows the Link header through every page, each request bounded by a timeout', async () => {
    const seen: { url: string; signal: AbortSignal | null | undefined }[] = [];
    const fetch = async (url: string, init: RequestInit) => {
      seen.push({ url, signal: init.signal });
      const next = url.endsWith('page=2')
        ? {}
        : { link: `<${API_BASE}/users/example/repos?page=2>; rel="next", <${API_BASE}/users/example/repos?page=2>; rel="last"` };
      return new Response(JSON.stringify([url.endsWith('page=2') ? 'b' : 'a']), { headers: next });
    };
    const items = await createClient({ token: TOKEN, fetch }).list<string>('/users/example/repos');
    assert.deepEqual(items, ['a', 'b']);
    assert.equal(seen.length, 2);
    assert.ok(seen.every(({ signal }) => signal instanceof AbortSignal));
  });
});
