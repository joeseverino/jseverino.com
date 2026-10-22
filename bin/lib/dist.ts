// Publishes a built site as one commit on the dist branch, from a temporary index, with no checkout
// of that branch. With a token and repository the commit is made through the API, which signs it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Fetch } from './drift.ts';
import { createClient } from './github.ts';
import { runSync } from './run.ts';
import { DIST_BRANCH } from '../../src/lib/site-config.ts';

export interface PublishOptions {
  // The repository checkout whose history the commit joins.
  repo: string;
  dir: string;
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

const BOT = { name: 'github-actions[bot]', email: '41898282+github-actions[bot]@users.noreply.github.com' };

export async function publishDist({ repo, dir, sha, push = false, token, repository, fetch }: PublishOptions): Promise<Published> {
  const git = (args: string[], { cwd = repo, env }: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) => runSync('git', args, { cwd, env });

  const heads = git(['ls-remote', '--heads', 'origin', DIST_BRANCH]);
  if (heads) git(['fetch', '--quiet', '--depth=1', 'origin', DIST_BRANCH]);
  const parent = heads ? git(['rev-parse', 'FETCH_HEAD']) : undefined;

  using scratch = fs.mkdtempDisposableSync(path.join(os.tmpdir(), 'dist-index-'));
  const env = { GIT_DIR: git(['rev-parse', '--absolute-git-dir']), GIT_WORK_TREE: path.resolve(dir), GIT_INDEX_FILE: path.join(scratch.path, 'index') };
  git(['add', '--all', '--force', '.'], { cwd: dir, env });
  const tree = git(['write-tree'], { cwd: dir, env });
  if (parent && git(['rev-parse', `${parent}^{tree}`]) === tree) return { status: 'unchanged', commit: parent };

  const identity = { GIT_AUTHOR_NAME: BOT.name, GIT_AUTHOR_EMAIL: BOT.email, GIT_COMMITTER_NAME: BOT.name, GIT_COMMITTER_EMAIL: BOT.email };
  const message = `deploy: ${sha.slice(0, 12)}\n\nSource: ${sha}`;
  const commit = git(['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', message], { env: identity });
  if (!push) return { status: 'committed', commit };

  // Through the environment, not argv, so the header never shows in a process listing.
  const auth = token
    ? { env: { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}` } }
    : {};
  if (!token || !repository) {
    git(['push', '--quiet', 'origin', `${commit}:refs/heads/${DIST_BRANCH}`], auth);
    return { status: 'pushed', commit };
  }

  // The tree goes up under a non-branch ref so nothing builds it; the API commit names that tree.
  const staging = `refs/dist-staging/${sha.slice(0, 12)}`;
  git(['push', '--quiet', 'origin', `${commit}:${staging}`], auth);
  try {
    const api = createClient({ token, fetch });
    const created = await api.request<{ sha: string }>('POST', `/repos/${repository}/git/commits`, { message, tree, parents: parent ? [parent] : [] });
    const signed = created?.sha;
    if (!signed) throw new Error('GitHub created no commit for the deploy tree');
    if (parent) await api.request('PATCH', `/repos/${repository}/git/refs/heads/${DIST_BRANCH}`, { sha: signed });
    else await api.request('POST', `/repos/${repository}/git/refs`, { ref: `refs/heads/${DIST_BRANCH}`, sha: signed });
    return { status: 'pushed', commit: signed };
  } finally {
    git(['push', '--quiet', 'origin', `:${staging}`], auth);
  }
}
