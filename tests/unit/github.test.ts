// Unit tests for the GitHub repository desired-state tool (bin/github.ts over
// bin/lib/github-settings.ts): the committed github/repo.json against its
// schema, then check, plan, and apply against an in-memory API seeded from
// tests/fixtures/github/live-drifted.json. No network.
//
//   npm run test:unit

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../bin/github.ts';
import { loadDesired, type DesiredState } from '../../bin/lib/github-settings.ts';
import type { JsonSchema } from '../../bin/lib/json-schema.ts';
import { createGithubFake, type FakeState } from './helpers/github-fake.ts';
import { fromRoot, read, runner, schemaTests } from './helpers/desired-state.ts';

const TOKEN = 'fixture-token-never-printed';
const seed = read<FakeState>('tests/fixtures/github/live-drifted.json');
const schema = read<JsonSchema>('github/repo.schema.json');
const desired = read<DesiredState>('github/repo.json');

// Every top-level DesiredState field, checked against the schema's properties
// below, so a field added to one and not the other fails here.
const DESIRED_FIELDS = { $schema: true, repository: true, settings: true, security: true, actions: true, ruleset: true } satisfies Record<keyof DesiredState, true>;

const { run, checkJson } = runner(main, (fake: ReturnType<typeof createGithubFake>) => ({ env: { GITHUB_TOKEN: TOKEN }, fetch: fake.fetch }));

const status = (report: { items: { name: string; status: string }[] }, name: string) => report.items.find((entry) => entry.name === name)?.status;

describe('github/repo.json', () => {
  schemaTests({ desired, schema, fields: DESIRED_FIELDS, load: () => loadDesired(fromRoot('github/repo.json'), fromRoot('github/repo.schema.json')) });

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
});

describe('check', () => {
  test('reports drift item by item, ignores rule and check order, and exits 1', async () => {
    const fake = createGithubFake(seed, TOKEN);
    const { code, report } = await checkJson(fake);
    assert.equal(code, 1);
    assert.equal(status(report, 'allow_merge_commit'), 'drift');
    assert.equal(status(report, 'allow_squash_merge'), 'ok');
    assert.equal(status(report, 'secret_scanning_push_protection'), 'drift');
    assert.equal(status(report, 'private_vulnerability_reporting'), 'drift');
    assert.equal(status(report, 'vulnerability_alerts'), 'ok');
    assert.equal(status(report, 'permissions'), 'drift');
    assert.equal(status(report, 'workflow token'), 'ok');
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
    const fake = createGithubFake(seed, TOKEN);
    const { output } = await run(fake, 'check');
    assert.ok(fake.calls.every((call) => call.authorization === `Bearer ${TOKEN}`));
    assert.ok(!output.includes(TOKEN));
  });

  test('a missing token stops before any request', async () => {
    const fake = createGithubFake(seed, TOKEN);
    await assert.rejects(main({ argv: ['check'], env: {}, fetch: fake.fetch, write: () => {} }), /GITHUB_TOKEN/);
    assert.equal(fake.calls.length, 0);
  });
});

describe('plan', () => {
  test('lists the fixing calls and touches nothing', async () => {
    const fake = createGithubFake(seed, TOKEN);
    const { code, output } = await run(fake, 'plan', '--json');
    assert.equal(code, 0);
    const { calls } = JSON.parse(output);
    const lines = calls.map((call: { method: string; path: string }) => `${call.method} ${call.path}`);
    const repo = '/repos/joeseverino/jseverino.com';
    assert.deepEqual(lines.toSorted(), [
      `PATCH ${repo}`,
      `PATCH ${repo}`,
      `PUT ${repo}/actions/permissions`,
      `PUT ${repo}/private-vulnerability-reporting`,
    ]);
    assert.equal(fake.writes().length, 0);
  });

  test('apply without --yes is a plan', async () => {
    const fake = createGithubFake(seed, TOKEN);
    const { code, output } = await run(fake, 'apply');
    assert.equal(code, 0);
    assert.match(output, /re-run with --yes/);
    assert.equal(fake.writes().length, 0);
  });
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
    assert.deepEqual((fake.state.repo.security_and_analysis as Record<string, unknown>).secret_scanning_push_protection, { status: 'enabled' });
    assert.equal(fake.state.privateReporting, true);
    assert.equal(fake.state.permissions.sha_pinning_required, true);

    const before = fake.writes().length;
    const second = await run(fake, 'apply', '--yes');
    assert.match(second.output, /no API calls needed/);
    assert.equal(fake.writes().length, before, 'a second apply makes no writes');
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
