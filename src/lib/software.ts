// The Software tab list, from GitHub (github.ts), the curation config, and the
// package-registry.json snapshot (PyPI/npm versions and downloads).

import registry from '../data/package-registry.json' with { type: 'json' };
import { asyncCache } from './async-cache.ts';
import { fixtureContent } from './content-root.ts';
import { getGithubRepos } from './github.ts';
import { joinInline } from './html.ts';
import { FEATURED, PACKAGES, type PackageConfig, SELF_HOSTED, SKIP, WRITEUPS } from './software.config.ts';

type SoftwarePackage = PackageConfig & {
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
  archived: boolean;
  writeupSlug?: string | undefined;
  package?: SoftwarePackage | undefined;
  order: number;
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// From the committed snapshot (`mise run snapshot:software`), so a build never calls PyPI or npm.
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
    .filter((repo) => !repo.fork && !SKIP.has(repo.name) && repo.description.trim() !== '')
    .map((repo) => {
      const config = PACKAGES[repo.name];
      const pkg: SoftwarePackage | undefined = config ? { ...config } : undefined;
      const rank = FEATURED.indexOf(repo.name);
      return {
        slug: slugify(repo.name),
        title: pkg?.name ?? repo.name,
        description: repo.description,
        repoUrl: repo.url,
        language: repo.language ?? undefined,
        updatedAt: repo.pushedAt || undefined,
        featured: rank >= 0,
        selfHosted: SELF_HOSTED.has(repo.name),
        archived: repo.archived,
        writeupSlug: WRITEUPS[repo.name],
        package: pkg,
        order: rank >= 0 ? rank : 999,
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

// 'YYYY-MM' -> 'Oct 2026'. A malformed snapshot value fails the build.
function formatUpdated(ym?: string): string {
  return ym ? Temporal.PlainYearMonth.from(ym).toPlainDate({ day: 1 }).toLocaleString('en-US', { month: 'short', year: 'numeric' }) : '';
}

export function metaLine(entry: SoftwareEntry): string {
  return joinInline([entry.language, formatUpdated(entry.updatedAt)]);
}
