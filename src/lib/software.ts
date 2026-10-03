// Orchestration for the Software tab. Composes three sources, none hand-keyed:
//   1. GitHub (github.ts)            -> which repos, description, language, pushed
//   2. curation config (.config.ts)  -> skip / featured / order / writeups / packages
//   3. PyPI + npm registries         -> live version + monthly downloads
// The result is the derived list the page renders. Add a repo on GitHub (with a
// description) and it appears; cut a release and the version updates.

import { getGithubRepos } from './github.ts';
import { asyncCache } from './async-cache.ts';
import { fixtureContent } from './content-root.ts';
import { fetchJson } from './fetch-json.ts';
import {
  FEATURED,
  ORDER,
  PACKAGES,
  SELF_HOSTED,
  SKIP,
  WRITEUPS,
  type PackageConfig,
} from './software.config.ts';

export type SoftwarePackage = PackageConfig & {
  version?: string | undefined;
  downloadsPerMonth?: number | undefined;
};

export type SoftwareEntry = {
  slug: string;
  title: string;
  description: string;
  repoUrl: string;
  language?: string | undefined;
  updatedAt?: string | undefined; // 'YYYY-MM'
  featured: boolean;
  selfHosted: boolean;
  writeupSlug?: string | undefined;
  package?: SoftwarePackage | undefined;
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
): Promise<Pick<SoftwarePackage, 'version' | 'downloadsPerMonth'>> {
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

  // Fixture builds are hermetic: no registry calls, so no live numbers.
  if (!fixtureContent) {
    await Promise.all(entries.map((entry) => (entry.package ? enrich(entry.package) : undefined)));
  }

  // Explicit order first, then alphabetical by title. Never by last-pushed: any
  // repo push (including a merge to this site) would reorder the list.
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
