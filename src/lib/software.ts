// The Software tab list, from GitHub (github.ts), the curation config, and the
// package-registry.json snapshot (PyPI/npm versions and downloads).

import { getGithubRepos } from './github.ts';
import { asyncCache } from './async-cache.ts';
import { fixtureContent } from './content-root.ts';
import registry from '../data/package-registry.json' with { type: 'json' };
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
  updatedAt?: string | undefined;
  featured: boolean;
  selfHosted: boolean;
  writeupSlug?: string | undefined;
  package?: SoftwarePackage | undefined;
  order: number;
};

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// From the committed snapshot (`npm run snapshot:software`), so a build never calls PyPI or npm.
const published: Record<string, { version?: string; downloadsPerMonth?: number }> = registry.packages;

function enrich(pkg: SoftwarePackage): void {
  const known = published[`${pkg.registry}:${pkg.name}`];
  pkg.version = known?.version;
  pkg.downloadsPerMonth = known?.downloadsPerMonth;
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

  if (!fixtureContent) {
    for (const entry of entries) if (entry.package) enrich(entry.package);
  }

  // Never by last-pushed: any repo push would reorder the list.
  return entries.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

export function getFeaturedSoftware(entries: SoftwareEntry[]): SoftwareEntry[] {
  return entries.filter((entry) => entry.featured);
}

export function getMoreSoftware(entries: SoftwareEntry[]): SoftwareEntry[] {
  return entries.filter((entry) => !entry.featured);
}

const updatedFormat = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

export function formatUpdated(ym?: string): string {
  const [, year, month] = /^(\d{4})-(\d{1,2})$/.exec(ym ?? '') ?? [];
  return year && month && Number(month) >= 1 && Number(month) <= 12
    ? updatedFormat.format(Date.UTC(Number(year), Number(month) - 1))
    : '';
}

export function metaLine(entry: SoftwareEntry): string {
  return [entry.language, formatUpdated(entry.updatedAt)].filter(Boolean).join(' · ');
}
