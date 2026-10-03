// The single place that knows the owner's public GitHub repos. Builds read the
// committed snapshot (src/data/github-repos.json), so a build never calls
// GitHub and needs no token.
// Fixture builds read the fixture root's snapshot instead.

import path from 'node:path';
import snapshot from '../data/github-repos.json' with { type: 'json' };
import { contentRoot, fixtureContent } from './content-root.ts';
import { readJson } from './json.ts';

export type GithubRepo = {
  name: string;
  description: string;
  url: string;
  language: string | null;
  pushedAt: string; // 'YYYY-MM'
  fork: boolean;
  archived: boolean;
};

export async function getGithubRepos(): Promise<GithubRepo[]> {
  if (!fixtureContent) return snapshot as GithubRepo[];
  return readJson<GithubRepo[]>(path.resolve(contentRoot, 'github-repos.json'));
}
