// The single place that talks to GitHub. Fetches the owner's public repos at
// BUILD time (Node, during `astro build`) — never in the browser, so CSP does
// not apply. Falls back to a committed snapshot if the API is unreachable, so a
// GitHub hiccup or rate limit can never break a deploy.

import snapshot from '../data/github-repos.json';

const OWNER = 'joeseverino';

export type GithubRepo = {
  name: string;
  description: string;
  url: string;
  language: string | null;
  pushedAt: string; // 'YYYY-MM'
  fork: boolean;
  archived: boolean;
};

type RestRepo = {
  name: string;
  description: string | null;
  html_url: string;
  language: string | null;
  pushed_at: string | null;
  fork: boolean;
  archived: boolean;
};

function fromRest(r: RestRepo): GithubRepo {
  return {
    name: r.name,
    description: r.description ?? '',
    url: r.html_url,
    language: r.language,
    pushedAt: (r.pushed_at ?? '').slice(0, 7),
    fork: r.fork,
    archived: r.archived,
  };
}

let cache: Promise<GithubRepo[]> | undefined;

export function getGithubRepos(): Promise<GithubRepo[]> {
  if (!cache) cache = load();
  return cache;
}

async function load(): Promise<GithubRepo[]> {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetch(
      `https://api.github.com/users/${OWNER}/repos?per_page=100&type=owner&sort=pushed`,
      { headers },
    );
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const data = (await res.json()) as RestRepo[];
    if (!Array.isArray(data) || data.length === 0) throw new Error('GitHub API empty');
    return data.map(fromRest);
  } catch (error) {
    console.warn(`[github] live fetch failed, using snapshot: ${(error as Error).message}`);
    return snapshot as GithubRepo[];
  }
}
