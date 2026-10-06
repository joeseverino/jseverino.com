// The package-registry lookups behind `npm run snapshot:software`
// (bin/lib/package-registry.ts): the parsing of each registry's answer and the
// rule that one failed lookup writes nothing.
//
//   npm run test:unit

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { lookup, snapshotPackages, type GetJson } from '../../bin/lib/package-registry.ts';

const registries = (overrides: Record<string, unknown> = {}): GetJson => (async (url: string) => {
  const answers: Record<string, unknown> = {
    'https://pypi.org/pypi/py-pkg/json': { info: { version: '1.2.3' } },
    'https://registry.npmjs.org/npm-pkg': { 'dist-tags': { latest: '0.4.0' } },
    'https://api.npmjs.org/downloads/point/last-month/npm-pkg': { downloads: 352 },
    ...overrides,
  };
  if (!(url in answers)) throw new Error(`HTTP 404: ${url}`);
  const answer = answers[url];
  if (answer instanceof Error) throw answer;
  return answer;
}) as GetJson;

describe('lookup', () => {
  test('reads a PyPI version and an npm version with its monthly downloads', async () => {
    assert.deepEqual(await lookup({ registry: 'pypi', name: 'py-pkg' }, registries()), { version: '1.2.3' });
    assert.deepEqual(await lookup({ registry: 'npm', name: 'npm-pkg' }, registries()), { version: '0.4.0', downloadsPerMonth: 352 });
  });

  test('rejects a missing version and a non-numeric download count', async () => {
    await assert.rejects(lookup({ registry: 'pypi', name: 'py-pkg' }, registries({ 'https://pypi.org/pypi/py-pkg/json': { info: {} } })), /no version/);
    await assert.rejects(
      lookup({ registry: 'npm', name: 'npm-pkg' }, registries({ 'https://api.npmjs.org/downloads/point/last-month/npm-pkg': { downloads: 'many' } })),
      /missing a version or download count/,
    );
  });
});

describe('snapshotPackages', () => {
  const packages = [{ registry: 'pypi', name: 'py-pkg' }, { registry: 'npm', name: 'npm-pkg' }] as const;

  test('keys every package by registry and name, sorted, with the date', async () => {
    const result = await snapshotPackages(packages, { getJson: registries(), today: new Date('2026-10-05T12:00:00Z') });
    assert.ok(result.ok);
    assert.deepEqual(result.snapshot, {
      generatedAt: '2026-10-05',
      packages: { 'npm:npm-pkg': { version: '0.4.0', downloadsPerMonth: 352 }, 'pypi:py-pkg': { version: '1.2.3' } },
    });
  });

  test('one failed lookup fails the whole snapshot and names it', async () => {
    const result = await snapshotPackages(packages, { getJson: registries({ 'https://pypi.org/pypi/py-pkg/json': new Error('registry down') }) });
    assert.ok(!result.ok);
    assert.deepEqual(result.failures, ['pypi:py-pkg: registry down']);
  });
});
