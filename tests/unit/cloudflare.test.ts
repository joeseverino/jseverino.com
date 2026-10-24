import assert from 'node:assert/strict';
import dns from 'node:dns';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { main } from '../../bin/cloudflare.ts';
import { type AccessPolicy, type DesiredState, loadDesired } from '../../bin/lib/cloudflare.ts';
import { type JsonSchema, validate } from '../../bin/lib/json-schema.ts';
import { PREVIEW_HOST_SUFFIX } from '../../src/lib/site-config.ts';
import { fromRoot, siteRoot } from '../../src/lib/site-root.ts';
import { createCloudflareFake, type FakeState } from './helpers/cloudflare-fake.ts';
import { read, runner, schemaTests } from './helpers/desired-state.ts';

const TOKEN = 'fixture-token-never-printed';
const PREVIEW_HOSTS = `*${PREVIEW_HOST_SUFFIX}`;
const fixture = read<FakeState>('tests/fixtures/cloudflare/live-drifted.json');
// The fixture's preview app, pointed at the Worker's real preview wildcard.
const previewApp = { ...fixture.accessApps[0], domain: PREVIEW_HOSTS };
const seed: FakeState = { ...fixture, accessApps: [previewApp] };
const schema = read<JsonSchema>('cloudflare/zone.schema.json');
const desired = read<DesiredState>('cloudflare/zone.json');

// A field added to the type and not the schema (or the reverse) fails here.
const DESIRED_FIELDS = {
  $schema: true,
  zone: true,
  owner: true,
  settings: true,
  hsts: true,
  dnssec: true,
  botManagement: true,
  firewall: true,
  rateLimit: true,
  preview: true,
  schemaValidation: true,
  turnstile: true,
} satisfies Record<keyof DesiredState, true>;

const { run, checkJson, ...shared } = runner(main, (fake: ReturnType<typeof createCloudflareFake>) => ({
  env: { CLOUDFLARE_API_TOKEN: TOKEN },
  fetch: fake.fetch,
}));
const previewItem = async (accessApps: FakeState['accessApps']) => {
  const { report } = await checkJson(createCloudflareFake({ ...seed, accessApps }, TOKEN));
  return report.items.find((entry: { area: string; name: string }) => entry.area === 'preview' && entry.name === 'access policy');
};

describe('cloudflare/zone.json', () => {
  schemaTests({ desired, schema, fields: DESIRED_FIELDS, load: () => loadDesired(fromRoot('cloudflare/zone.json'), fromRoot('cloudflare/zone.schema.json')) });

  test('the schema keeps one custom rule free and rejects unknown settings', () => {
    const fifth = { ...desired, firewall: Array.from({ length: 5 }, () => desired.firewall[0]) };
    assert.ok(validate(schema, fifth).some((problem: string) => problem.includes('more than 4 items')));
    const extra = { ...desired, settings: { ...desired.settings, polish: 'lossy' } };
    assert.ok(validate(schema, extra).some((problem: string) => problem.includes('unexpected property polish')));
  });

  test('carries no account or zone id', () => {
    const text = fs.readFileSync(path.join(siteRoot, 'cloudflare/zone.json'), 'utf8');
    assert.doesNotMatch(text, /\b[0-9a-f]{32}\b/);
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
    assert.equal(status('jseverino-com-api-request'), 'drift');
    assert.equal(status('jseverino-com-api-method'), 'drift', 'a rule zone.json no longer lists is deleted');
    assert.equal(status('rule budget'), 'ok');
    assert.equal(status('jseverino-com-retired'), 'drift');
    assert.equal(status('jseverino-com-api-rate'), 'drift');
    assert.equal(status('access policy'), 'manual');
    assert.equal(status('domains'), 'drift');
    assert.equal(fake.writes().length, 0, 'check is read-only');
  });

  test('the rule budget counts dashboard rules and flags a total over the limit', async () => {
    const crowded = structuredClone(seed);
    const phase = crowded.rulesets['zones/http_request_firewall_custom'];
    assert.ok(phase);
    for (const n of [1, 2, 3])
      phase.rules.push({
        id: `rule-dashboard-${n}`,
        ref: `dashboard-${n}`,
        description: 'Made in the dashboard',
        expression: '(ip.src eq 192.0.2.2)',
        action: 'block',
        enabled: true,
      });
    const { report } = await checkJson(createCloudflareFake(crowded, TOKEN));
    const budget = report.items.find((entry: { name: string }) => entry.name === 'rule budget');
    assert.equal(budget.status, 'manual');
    assert.match(budget.note, /4 dashboard rules plus 2 in zone\.json/);
  });

  test('previews without an Access app on their wildcard are a manual item', async () => {
    for (const accessApps of [[], [{ ...previewApp, domain: '*.example.workers.dev' }]]) {
      const access = await previewItem(accessApps);
      assert.equal(access.status, 'manual');
      assert.equal(access.have, 'absent');
      assert.ok(access.note.includes(PREVIEW_HOSTS), 'the note names the wildcard to protect');
    }
  });

  test('the preview Access app takes Service Auth policies only; apply never touches Access', async () => {
    const policyItem = (policies: AccessPolicy[]) => previewItem([{ ...previewApp, policies }]);
    const ci = { name: 'ci', decision: 'non_identity', include: [{ service_token: { token_id: 'token-ci' } }] };
    const proxy = { name: 'proxy', decision: 'non_identity', include: [{ service_token: { token_id: 'token-proxy' } }] };
    assert.equal((await policyItem([ci, proxy])).status, 'ok');
    assert.equal((await policyItem([{ ...ci, include: [{ any_valid_service_token: {} }] }])).status, 'ok');
    const { domain: _, ...byDestination } = previewApp;
    assert.equal(
      (await previewItem([{ ...byDestination, destinations: [{ uri: PREVIEW_HOSTS }], policies: [ci] }])).status,
      'ok',
      'an app naming the wildcard as a destination covers it',
    );

    const human = await policyItem([ci, { name: 'me', decision: 'allow', include: [{ email: { email: 'me@example.com' } }] }]);
    assert.equal(human.status, 'manual');
    assert.match(human.have, /me \(allow\)/);
    assert.equal((await policyItem([{ ...ci, include: [{ service_token: {} }, { everyone: {} }] }])).status, 'manual', 'a token plus everyone admits everyone');
    assert.equal((await policyItem([])).status, 'manual', 'no policy at all is not service auth');

    const fake = createCloudflareFake(seed, TOKEN);
    await run(fake, 'apply', '--yes');
    assert.ok(
      fake.writes().every((call) => !call.path.includes('/access/')),
      'apply makes no Access call',
    );
  });

  test('sends the token only as a bearer header and never prints it', async () => {
    const output = await shared.bearerOnly(createCloudflareFake(seed, TOKEN), TOKEN);
    assert.ok(!output.includes('zone-0001') && !output.includes('account-0001'), 'no zone or account id in output');
  });

  // Token IP filters list IPv4 addresses; the zone tool and the D1 reads share this client.
  test('loading the client resolves IPv4 addresses first', async () => {
    const original = dns.getDefaultResultOrder();
    try {
      dns.setDefaultResultOrder('verbatim');
      // A query makes a fresh module instance, so its top level runs again.
      await import(new URL('../../bin/lib/cloudflare.ts?fresh', import.meta.url).href);
      assert.equal(dns.getDefaultResultOrder(), 'ipv4first');
    } finally {
      dns.setDefaultResultOrder(original);
    }
  });

  test('a missing token stops before any request', () => shared.missingTokenStops(createCloudflareFake(seed, TOKEN), /CLOUDFLARE_API_TOKEN/));
});

describe('plan', () => {
  test('lists the fixing calls and touches nothing', async () => {
    const lines = await shared.planLines(createCloudflareFake(seed, TOKEN));
    assert.ok(lines.includes('PATCH /zones/:zone/settings/automatic_https_rewrites'));
    assert.ok(lines.includes('PUT /zones/:zone/bot_management'));
    assert.ok(lines.includes('PATCH /zones/:zone/settings/browser_cache_ttl'));
    assert.ok(lines.includes('DELETE /zones/:zone/rulesets/ruleset-fw/rules/rule-api-method'));
    assert.ok(lines.includes('DELETE /zones/:zone/rulesets/ruleset-fw/rules/rule-retired'));
    assert.ok(lines.includes('PUT /zones/:zone/rulesets/phases/http_ratelimit/entrypoint'));
    assert.ok(lines.includes('PUT /zones/:zone/schema_validation/settings/operations/:operation'));
    assert.ok(lines.includes('PUT /accounts/:account/challenges/widgets/:sitekey'));
    assert.equal(lines.filter((line: string) => line.includes('rule-incident')).length, 0, 'the unowned rule is never in a plan');
    const rules = (verb: string) => lines.findIndex((line: string) => line.startsWith(`${verb} /zones/:zone/rulesets/ruleset-fw/rules`));
    assert.ok(rules('DELETE') < rules('POST'), 'deletes come before creates, so a plan at the rule limit frees a slot first');
    assert.ok(!lines.some((line: string) => line.includes('settings/tls_1_3')), 'settings already right are left alone');
  });

  test('apply without --yes is a plan', () => shared.applyWithoutYesIsAPlan(createCloudflareFake(seed, TOKEN)));
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
    assert.deepEqual(
      first.output.match(/^still +.*$/gm)?.map((line) => line.replace(/:.*/, '')),
      ['still    preview access policy'],
    );

    const firewall = fake.state.rulesets['zones/http_request_firewall_custom']?.rules ?? [];
    assert.deepEqual(
      firewall.find((rule) => rule.ref === incident?.ref),
      incident,
    );
    assert.deepEqual(firewall.map((rule) => rule.ref).sort(), ['incident-2026-09', ...desired.firewall.map((rule) => `jseverino-com-${rule.id}`)].sort());
    assert.equal(fake.state.settings.browser_cache_ttl?.value, 0);
    assert.deepEqual(
      Object.fromEntries(Object.entries(fake.state.botManagement).filter(([key]) => key in desired.botManagement || key.endsWith('_protection'))),
      { ...desired.botManagement, ai_bots_protection: 'block', content_bots_protection: 'block', crawler_protection: 'disabled' },
      'the declared fields are set and the undeclared writable ones keep their live values',
    );
    const header = fake.state.settings.security_header?.value as { strict_transport_security: { nosniff: boolean } };
    assert.equal(header.strict_transport_security.nosniff, false, 'HSTS keeps fields zone.json does not own');
    assert.equal(fake.state.validationSettings.validation_default_mitigation_action, 'none', "the zone default is not this file's");
    assert.equal(fake.state.operationSettings['op-contact']?.mitigation_action, 'block');
    assert.deepEqual(fake.state.widgets[0]?.domains, ['jseverino.com']);
    assert.equal(fake.state.widgets[0]?.mode, 'managed');
    assert.deepEqual(
      fake.state.schemas.map((entry) => [entry.name, entry.source]),
      [['jseverino-com-contact', fs.readFileSync(path.join(siteRoot, desired.schemaValidation.file), 'utf8')]],
    );

    await shared.reapplyIsNoOp(fake);
  });

  test('creates a missing firewall entrypoint whole', async () => {
    const fake = createCloudflareFake({ ...seed, rulesets: {} }, TOKEN);
    await run(fake, 'apply', '--yes');
    const puts = fake.writes().filter((call) => call.path.endsWith('/phases/http_request_firewall_custom/entrypoint'));
    assert.equal(puts.length, 1);
    assert.equal((puts[0]?.body as { rules: unknown[] } | undefined)?.rules.length, desired.firewall.length);
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
