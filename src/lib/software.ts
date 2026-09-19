// Orchestration for the Software tab. Composes three sources, none hand-keyed:
//   1. GitHub (github.ts)            -> which repos, description, language, pushed
//   2. curation config (.config.ts)  -> skip / featured / order / writeups / packages
//   3. PyPI + npm registries         -> live version + monthly downloads
// The result is the derived list the page renders. Add a repo on GitHub (with a
// description) and it appears; cut a release and the version updates.

import { getGithubRepos } from './github';
import { asyncCache } from './async-cache';
import { fetchJson } from './fetch-json';
import {
  FEATURED,
  ORDER,
  PACKAGES,
  SELF_HOSTED,
  SKIP,
  WRITEUPS,
  type PackageConfig,
} from './software.config';

export type SoftwarePackage = PackageConfig & {
  version?: string;
  downloadsPerMonth?: number;
};

export type SoftwareEntry = {
  slug: string;
  title: string;
  description: string;
  repoUrl: string;
  language?: string;
  updatedAt?: string; // 'YYYY-MM'
  featured: boolean;
  selfHosted: boolean;
  writeupSlug?: string;
  package?: SoftwarePackage;
  order: number;
};

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function fetchPypiVersion(name: string): Promise<string | undefined> {
  try {
    const data = await fetchJson<{ info?: { version?: string } }>(`https://pypi.org/pypi/${name}/json`);
    return data.info?.version;
  } catch {
    return undefined;
  }
}

async function fetchNpmInfo(
  name: string,
): Promise<{ version?: string; downloadsPerMonth?: number }> {
  const [version, downloads] = await Promise.allSettled([
    fetchJson<{ 'dist-tags'?: { latest?: string } }>(`https://registry.npmjs.org/${name}`),
    fetchJson<{ downloads?: number }>(`https://api.npmjs.org/downloads/point/last-month/${name}`),
  ]);
  return {
    version: version.status === 'fulfilled' ? version.value?.['dist-tags']?.latest : undefined,
    downloadsPerMonth: downloads.status === 'fulfilled' ? downloads.value?.downloads : undefined,
  };
}

async function enrich(pkg: SoftwarePackage): Promise<void> {
  if (pkg.registry === 'pypi') {
    pkg.version = await fetchPypiVersion(pkg.name);
  } else {
    const info = await fetchNpmInfo(pkg.name);
    pkg.version = info.version;
    pkg.downloadsPerMonth = info.downloadsPerMonth;
  }
}

export const getSoftware = asyncCache(build);

async function build(): Promise<SoftwareEntry[]> {
  const repos = await getGithubRepos();

  const entries: SoftwareEntry[] = repos
    .filter(
      (repo) =>
        !repo.fork && !repo.archived && !SKIP.has(repo.name) && repo.description.trim() !== '',
    )
    .map((repo) => {
      const config = PACKAGES[repo.name];
      const pkg: SoftwarePackage | undefined = config ? { ...config } : undefined;
      return {
        slug: slugify(repo.name),
        title: pkg?.name ?? repo.name,
        description: repo.description,
        repoUrl: repo.url,
        language: repo.language ?? undefined,
        updatedAt: repo.pushedAt || undefined,
        featured: FEATURED.has(repo.name),
        selfHosted: SELF_HOSTED.has(repo.name),
        writeupSlug: WRITEUPS[repo.name],
        package: pkg,
        order: ORDER[repo.name] ?? 999,
      };
    });

  await Promise.all(entries.map((entry) => (entry.package ? enrich(entry.package) : undefined)));

  // Deterministic: explicit order first, then alphabetical by title. Crucially
  // NOT by last-pushed — that depends on GitHub's volatile push ordering, so any
  // repo push (including merging this site) would reorder the list and break the
  // visual baseline. Stable order keeps the snapshot valid across pushes.
  return entries.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

export function getFeaturedSoftware(entries: SoftwareEntry[]): SoftwareEntry[] {
  return entries.filter((entry) => entry.featured);
}

export function getMoreSoftware(entries: SoftwareEntry[]): SoftwareEntry[] {
  return entries.filter((entry) => !entry.featured);
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** 'YYYY-MM' -> 'Jun 2026'. Empty string for missing/invalid input. */
export function formatUpdated(ym?: string): string {
  if (!ym) return '';
  const [year, month] = ym.split('-');
  const label = MONTHS[Number(month) - 1];
  return label ? `${label} ${year}` : '';
}

/** 'Python · Jun 2026' from an entry's language + updatedAt. */
export function metaLine(entry: SoftwareEntry): string {
  return [entry.language, formatUpdated(entry.updatedAt)].filter(Boolean).join(' · ');
}
