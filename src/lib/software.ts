// Orchestration for the Software tab. Composes three sources, none hand-keyed:
//   1. GitHub (github.ts)            -> which repos, description, language, pushed
//   2. curation config (.config.ts)  -> skip / featured / order / writeups / packages
//   3. PyPI + npm registries         -> live version + monthly downloads
// The result is the derived list the page renders. Add a repo on GitHub (with a
// description) and it appears; cut a release and the version updates.

import { getGithubRepos } from './github';
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
    const res = await fetch(`https://pypi.org/pypi/${name}/json`);
    if (!res.ok) return undefined;
    const data = (await res.json()) as { info?: { version?: string } };
    return data.info?.version;
  } catch {
    return undefined;
  }
}

async function fetchNpmInfo(
  name: string,
): Promise<{ version?: string; downloadsPerMonth?: number }> {
  const out: { version?: string; downloadsPerMonth?: number } = {};
  try {
    const res = await fetch(`https://registry.npmjs.org/${name}`);
    if (res.ok) {
      const data = (await res.json()) as { 'dist-tags'?: { latest?: string } };
      out.version = data['dist-tags']?.latest;
    }
  } catch {
    /* version stays undefined */
  }
  try {
    const res = await fetch(`https://api.npmjs.org/downloads/point/last-month/${name}`);
    if (res.ok) {
      const data = (await res.json()) as { downloads?: number };
      out.downloadsPerMonth = data.downloads;
    }
  } catch {
    /* downloads are optional */
  }
  return out;
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

let cache: Promise<SoftwareEntry[]> | undefined;

export function getSoftware(): Promise<SoftwareEntry[]> {
  if (!cache) cache = build();
  return cache;
}

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

  return entries.sort(
    (a, b) => a.order - b.order || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''),
  );
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
