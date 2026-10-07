// PyPI and npm lookups for the Software tab, apart from bin/snapshot-software.ts so the all-or-nothing rule is testable offline.
import { fetchJson } from '../../src/lib/fetch-json.ts';
import { errorMessage } from '../../src/lib/error-message.ts';

export type RegistryPackage = { registry: 'pypi' | 'npm'; name: string };
export type RegistryEntry = { version: string; downloadsPerMonth?: number };
export type GetJson = <T>(url: string) => Promise<T>;

export const packageKey = ({ registry, name }: RegistryPackage): string => `${registry}:${name}`;

export async function lookup({ registry, name }: RegistryPackage, getJson: GetJson = fetchJson): Promise<RegistryEntry> {
  if (registry === 'pypi') {
    const data = await getJson<{ info?: { version?: string } }>(`https://pypi.org/pypi/${name}/json`);
    if (!data.info?.version) throw new Error('no version');
    return { version: data.info.version };
  }
  const [meta, downloads] = await Promise.all([
    getJson<{ 'dist-tags'?: { latest?: string } }>(`https://registry.npmjs.org/${name}`),
    getJson<{ downloads?: number }>(`https://api.npmjs.org/downloads/point/last-month/${name}`),
  ]);
  const version = meta['dist-tags']?.latest;
  if (!version || typeof downloads.downloads !== 'number') throw new Error('missing a version or download count');
  return { version, downloadsPerMonth: downloads.downloads };
}

export type RegistrySnapshot = { generatedAt: string; packages: Record<string, RegistryEntry> };

// Every package, or none: one failed lookup fails the snapshot, so a registry
// outage cannot blank a number.
export async function snapshotPackages(
  packages: readonly RegistryPackage[],
  { getJson = fetchJson, today = new Date() }: { getJson?: GetJson; today?: Date } = {},
): Promise<{ ok: true; snapshot: RegistrySnapshot } | { ok: false; failures: string[] }> {
  const outcomes = await Promise.all(
    packages.toSorted((a, b) => a.name.localeCompare(b.name)).map(async (pkg) => {
      try {
        return { pkg, entry: await lookup(pkg, getJson) };
      } catch (error) {
        return { pkg, failure: errorMessage(error) };
      }
    }),
  );
  const failures = outcomes.flatMap((outcome) => ('failure' in outcome ? [`${packageKey(outcome.pkg)}: ${outcome.failure}`] : []));
  if (failures.length > 0) return { ok: false, failures };

  const entries = outcomes.flatMap((outcome) => ('entry' in outcome ? [[packageKey(outcome.pkg), outcome.entry] as const] : []));
  return { ok: true, snapshot: { generatedAt: today.toISOString().slice(0, 10), packages: Object.fromEntries(entries) } };
}
