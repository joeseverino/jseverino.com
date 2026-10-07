// Unit tests for the Cloudflare desired-state tool (bin/cloudflare.ts over
// bin/lib/cloudflare.ts): the committed cloudflare/zone.json against its
// schema, then check, plan, and apply against an in-memory API seeded from
// tests/fixtures/cloudflare/live-drifted.json. No network.
//
//   npm run test:unit

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { main } from '../../bin/cloudflare.ts';
import { loadDesired, type AccessPolicy, type DesiredState } from '../../bin/lib/cloudflare.ts';
import { validate, type JsonSchema } from '../../bin/lib/json-schema.ts';
import { siteRoot } from '../../src/lib/site-root.ts';
import { createCloudflareFake, type FakeState } from './helpers/cloudflare-fake.ts';
import { fromRoot, read, runner, schemaTests } from './helpers/desired-state.ts';

const TOKEN = 'fixture-token-never-printed';
const seed = read<FakeState>('tests/fixtures/cloudflare/live-drifted.json');
const schema = read<JsonSchema>('cloudflare/zone.schema.json');
const desired = read<DesiredState>('cloudflare/zone.json');

// Every top-level DesiredState field, checked against the schema's properties
// below, so a field added to one and not the other fails here.
const DESIRED_FIELDS = {
  $schema: true, zone: true, owner: true, settings: true, hsts: true, dnssec: true, botManagement: true, firewall: true,
  rateLimit: true, pagesDevRedirect: true, pages: true, schemaValidation: true, turnstile: true,
} satisfies Record<keyof DesiredState, true>;

const { run, checkJson } = runner(main, (fake: ReturnType<typeof createCloudflareFake>) => ({ env: { CLOUDFLARE_API_TOKEN: TOKEN }, fetch: fake.fetch, wait: async () => {} }));

describe('cloudflare/zone.json', () => {
  schemaTests({ desired, schema, fields: DESIRED_FIELDS, load: () => loadDesired(fromRoot('cloudflare/zone.json'), fromRoot('cloudflare/zone.schema.json')) });

  test('the schema keeps one custom rule free and rejects unknown settings', () => {
    const fifth = { ...desired, firewall: [...desired.firewall, desired.firewall[0]] };
    assert.ok(validate(schema, fifth).some((problem: string) => problem.includes('more than 4 items')));
    const extra = { ...desired, settings: { ...desired.settings, polish: 'lossy' } };
    assert.ok(validate(schema, extra).some((problem: string) => problem.includes('unexpected property polish')));
  });

  test('carries no account or zone id', () => {
    const text = fs.readFileSync(path.join(siteRoot, 'cloudflare/zone.json'), 'utf8');
    assert.doesNotMatch(text, /\b[0-9a-f]{32}\b/);
  });

  test('closes jseverino.pages.dev without touching preview subdomains', () => {
    assert.equal(desired.pagesDevRedirect.include_subdomains, false);
    assert.equal(desired.pagesDevRedirect.subpath_matching, true);
    assert.equal(desired.pagesDevRedirect.preserve_query_string, true);
  });
});

describe('check', () => {
  test('reports drift item by item and exits 1', async () => {
    const fake = createCloudflareFake(seed, TOKEN);
    const { code, report } = await checkJson(fake);
    assert.equal(code, 1);
    const status = (name: string) => report.items.find((entry: { name: string }) => entry.name === name)?.status;
    assert.equal(status('automatic_https_rewrites'), 'drift');
    assert.equal(status('browser_cache_ttl'), 'drift');
    assert.equal(status('email_obfuscation'), 'drift');
    assert.equal(status('tls_1_3'), 'ok');
    assert.equal(status('bot_management'), 'drift');
    assert.equal(status('hsts'), 'ok');
    assert.equal(status('server_side_exclude'), 'unavailable');
    assert.equal(status('jseverino-com-api-method'), 'drift');
    assert.equal(status('jseverino-com-scanner-noise'), 'drift');
    assert.equal(status('jseverino-com-retired'), 'drift');
    assert.equal(status('jseverino-com-api-rate'), 'drift');
    assert.equal(status('compatibility_date'), 'drift');
    assert.equal(status('preview access'), 'ok');
    assert.equal(status('preview access policy'), 'manual');
    assert.equal(fake.writes().length, 0, 'check is read-only');
  });

  test('a preview deployment without an Access app is a manual item', async () => {
    const fake = createCloudflareFake({ ...seed, accessApps: [] }, TOKEN);
    const { report } = await checkJson(fake);
    const access = report.items.find((entry: { name: string }) => entry.name === 'preview access');
    assert.equal(access.status, 'manual');
    assert.match(access.note, /Enable access policy/);
  });

  test('the preview Access app takes Service Auth policies only; apply never touches Access', async () => {
    const policyItem = async (policies: AccessPolicy[]) => {
      const accessApps = [{ ...seed.accessApps[0], policies }];
      const fake = createCloudflareFake({ ...seed, accessApps }, TOKEN);
      const { report } = await checkJson(fake);
      return report.items.find((entry: { name: string }) => entry.name === 'preview access policy');
    };
    const ci = { name: 'ci', decision: 'non_identity', include: [{ service_token: { token_id: 'token-ci' } }] };
    const proxy = { name: 'proxy', decision: 'non_identity', include: [{ service_token: { token_id: 'token-proxy' } }] };
    assert.equal((await policyItem([ci, proxy])).status, 'ok');
    assert.equal((await policyItem([{ ...ci, include: [{ any_valid_service_token: {} }] }])).status, 'ok');

    const human = await policyItem([ci, { name: 'me', decision: 'allow', include: [{ email: { email: 'me@example.com' } }] }]);
    assert.equal(human.status, 'manual');
    assert.match(human.have, /me \(allow\)/);
    assert.equal((await policyItem([{ ...ci, include: [{ service_token: {} }, { everyone: {} }] }])).status, 'manual', 'a token plus everyone admits everyone');
    assert.equal((await policyItem([])).status, 'manual', 'no policy at all is not service auth');

    const fake = createCloudflareFake(seed, TOKEN);
    await run(fake, 'apply', '--yes');
    assert.ok(fake.writes().every((call) => !call.path.includes('/access/')), 'apply makes no Access call');
  });

  test('sends the token only as a bearer header and never prints it', async () => {
    const fake = createCloudflareFake(seed, TOKEN);
    const { output } = await run(fake, 'check');
    assert.ok(fake.calls.every((call) => call.authorization === `Bearer ${TOKEN}`));
    assert.ok(!output.includes(TOKEN));
    assert.ok(!output.includes('zone-0001') && !output.includes('account-0001'), 'no zone or account id in output');
  });

  test('a missing token stops before any request', async () => {
    const fake = createCloudflareFake(seed, TOKEN);
    await assert.rejects(main({ argv: ['check'], env: {}, fetch: fake.fetch, write: () => {} }), /CLOUDFLARE_API_TOKEN/);
    assert.equal(fake.calls.length, 0);
  });
});

describe('plan', () => {
  test('lists the fixing calls and touches nothing', async () => {
    const fake = createCloudflareFake(seed, TOKEN);
    const { code, output } = await run(fake, 'plan', '--json');
    assert.equal(code, 0);
    const { calls } = JSON.parse(output);
    const lines = calls.map((call: { method: string; path: string }) => `${call.method} ${call.path}`);
    assert.ok(lines.includes('PATCH /zones/:zone/settings/automatic_https_rewrites'));
    assert.ok(lines.includes('PUT /zones/:zone/bot_management'));
    assert.ok(lines.includes('PATCH /zones/:zone/settings/browser_cache_ttl'));
    assert.ok(lines.includes('PATCH /zones/:zone/rulesets/ruleset-fw/rules/rule-api-method'));
    assert.ok(lines.includes('DELETE /zones/:zone/rulesets/ruleset-fw/rules/rule-retired'));
    assert.ok(lines.includes('PUT /zones/:zone/rulesets/phases/http_ratelimit/entrypoint'));
    assert.ok(lines.includes('POST /accounts/:account/rules/lists'));
    assert.ok(lines.includes('PUT /accounts/:account/rulesets/phases/http_request_redirect/entrypoint'));
    assert.ok(lines.includes('PUT /zones/:zone/schema_validation/settings/operations/:operation'));
    assert.ok(lines.includes('PUT /accounts/:account/challenges/widgets/:sitekey'));
    assert.equal(lines.filter((line: string) => line.includes('rule-incident')).length, 0, 'the unowned rule is never in a plan');
    assert.ok(!lines.some((line: string) => line.includes('settings/tls_1_3')), 'settings already right are left alone');
    assert.equal(fake.writes().length, 0);
  });

  test('apply without --yes is a plan', async () => {
    const fake = createCloudflareFake(seed, TOKEN);
    const { code, output } = await run(fake, 'apply');
    assert.equal(code, 0);
    assert.match(output, /re-run with --yes/);
    assert.equal(fake.writes().length, 0);
  });
});

describe('apply --yes', () => {
  test('converges, leaves the unowned rule alone, and re-applies as a no-op', async () => {
    const fake = createCloudflareFake(seed, TOKEN);
    const incident = structuredClone(seed.rulesets['zones/http_request_firewall_custom']?.rules[0]);

    const first = await run(fake, 'apply', '--yes');
    assert.ok(fake.writes().length > 0);
    assert.ok(fake.writes().every((call) => !call.path.includes('rule-incident')));

    // Access is check-only, so its policy is the one item left, for a person.
    assert.equal(first.code, 1);
    assert.deepEqual(first.output.match(/^still +.*$/gm)?.map((line) => line.replace(/:.*/, '')), ['still    pages preview access policy']);

    const firewall = fake.state.rulesets['zones/http_request_firewall_custom']?.rules ?? [];
    assert.deepEqual(firewall.find((rule) => rule.ref === incident?.ref), incident);
    assert.deepEqual(firewall.map((rule) => rule.ref).sort(), [
      'incident-2026-09',
      ...desired.firewall.map((rule) => `jseverino-com-${rule.id}`),
    ].sort());
    assert.equal(fake.state.settings.browser_cache_ttl?.value, 0);
    assert.deepEqual(
      Object.fromEntries(Object.entries(fake.state.botManagement).filter(([key]) => key in desired.botManagement || key.endsWith('_protection'))),
      { ...desired.botManagement, ai_bots_protection: 'block', content_bots_protection: 'block', crawler_protection: 'disabled' },
      'the declared fields are set and the undeclared writable ones keep their live values',
    );
    const header = fake.state.settings.security_header?.value as { strict_transport_security: { nosniff: boolean } };
    assert.equal(header.strict_transport_security.nosniff, false, 'HSTS keeps fields zone.json does not own');
    assert.equal(fake.state.validationSettings.validation_default_mitigation_action, 'none', 'the zone default is not this file\'s');
    assert.equal(fake.state.operationSettings['op-contact']?.mitigation_action, 'block');
    assert.deepEqual(fake.state.widgets[0]?.domains, ['jseverino.com']);
    assert.equal(fake.state.widgets[0]?.mode, 'managed');
    assert.deepEqual(fake.state.lists[0]?.items.map((entry) => entry.redirect), [{
      source_url: 'jseverino.pages.dev/',
      target_url: 'https://jseverino.com',
      status_code: 301,
      preserve_query_string: true,
      subpath_matching: true,
      preserve_path_suffix: true,
      include_subdomains: false,
    }]);
    assert.deepEqual(fake.state.schemas.map((entry) => [entry.name, entry.source]), [
      ['jseverino-com-contact', fs.readFileSync(path.join(siteRoot, desired.schemaValidation.file), 'utf8')],
    ]);

    const before = fake.writes().length;
    const second = await run(fake, 'apply', '--yes');
    assert.match(second.output, /no API calls needed/);
    assert.equal(fake.writes().length, before, 'a second apply makes no writes');
  });

  test('creates a missing firewall entrypoint whole', async () => {
    const fake = createCloudflareFake({ ...seed, rulesets: {} }, TOKEN);
    await run(fake, 'apply', '--yes');
    const puts = fake.writes().filter((call) => call.path.endsWith('/phases/http_request_firewall_custom/entrypoint'));
    assert.equal(puts.length, 1);
    assert.equal((puts[0]?.body as { rules: unknown[] }).rules.length, desired.firewall.length);
  });

  test('a token without edit rights fails loudly without printing it', async () => {
    const fake = createCloudflareFake(seed, 'a-different-token');
    await assert.rejects(run(fake, 'apply', '--yes'), (error: Error) => {
      assert.match(error.message, /GET \/zones\?name=jseverino\.com → 403/);
      assert.ok(!error.message.includes(TOKEN));
      return true;
    });
  });
});
