// Publishes a built site as one commit on a branch, built from the directory with a
// temporary index, so no checkout or worktree of that branch is needed. With a token and
// repository the commit is created through the API, which GitHub signs; without them it
// is pushed as built here, unsigned.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Fetch } from './drift.ts';
import { createClient } from './github-settings.ts';
import { runSync } from './run.ts';

export interface PublishOptions {
  // The repository checkout whose history the commit joins.
  repo: string;
  dir: string;
  branch: string;
  // The source commit the build came from.
  sha: string;
  push?: boolean;
  // An Actions token or PAT; sent as a header, never put in a URL or logged.
  token?: string | undefined;
  // owner/name, for the API.
  repository?: string | undefined;
  fetch?: Fetch | undefined;
}

export interface Published {
  status: 'unchanged' | 'committed' | 'pushed';
  commit: string;
}

// The file a route is served from: /about/ is about/index.html.
export const routeFile = (pathname: string): string => `${pathname.replace(/^\//, '')}${pathname.endsWith('/') ? 'index.html' : ''}`;

const BOT = { name: 'github-actions[bot]', email: '41898282+github-actions[bot]@users.noreply.github.com' };

export async function publishDist({ repo, dir, branch, sha, push = false, token, repository, fetch }: PublishOptions): Promise<Published> {
  if (!/^[a-z][a-z0-9/_-]*$/.test(branch)) throw new Error(`not a publishable branch name: ${branch}`);
  const git = (args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) =>
    runSync('git', args, { cwd: options.cwd ?? repo, ...(options.env && { env: options.env }) });

  const heads = git(['ls-remote', '--heads', 'origin', branch]);
  if (heads) git(['fetch', '--quiet', '--depth=1', 'origin', branch]);
  const parent = heads ? git(['rev-parse', 'FETCH_HEAD']) : undefined;

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-index-'));
  try {
    const env = { GIT_DIR: git(['rev-parse', '--absolute-git-dir']), GIT_WORK_TREE: path.resolve(dir), GIT_INDEX_FILE: path.join(scratch, 'index') };
    git(['add', '--all', '--force', '.'], { cwd: dir, env });
    const tree = git(['write-tree'], { cwd: dir, env });
    if (parent && git(['rev-parse', `${parent}^{tree}`]) === tree) return { status: 'unchanged', commit: parent };

    const identity = { GIT_AUTHOR_NAME: BOT.name, GIT_AUTHOR_EMAIL: BOT.email, GIT_COMMITTER_NAME: BOT.name, GIT_COMMITTER_EMAIL: BOT.email };
    const message = `deploy: ${sha.slice(0, 12)}\n\nSource: ${sha}`;
    const commit = git(['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', message], { env: identity });
    if (!push) return { status: 'committed', commit };

    const auth = token ? ['-c', `http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`] : [];
    if (!token || !repository) {
      git([...auth, 'push', '--quiet', 'origin', `${commit}:refs/heads/${branch}`]);
      return { status: 'pushed', commit };
    }

    // The tree goes up under a ref that is not a branch, so nothing builds it; the API commit
    // names that tree, and GitHub signs commits it creates for the Actions token.
    const staging = `refs/dist-staging/${sha.slice(0, 12)}`;
    git([...auth, 'push', '--quiet', 'origin', `${commit}:${staging}`]);
    try {
      const api = createClient({ token, ...(fetch && { fetch }) });
      const created = await api.request<{ sha: string }>('POST', `/repos/${repository}/git/commits`, { message, tree, parents: parent ? [parent] : [] });
      const signed = created?.sha ?? '';
      if (parent) await api.request('PATCH', `/repos/${repository}/git/refs/heads/${branch}`, { sha: signed });
      else await api.request('POST', `/repos/${repository}/git/refs`, { ref: `refs/heads/${branch}`, sha: signed });
      return { status: 'pushed', commit: signed };
    } finally {
      git([...auth, 'push', '--quiet', 'origin', `:${staging}`]);
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
