// Publishes a built site as one commit on the dist branch, from a temporary index, with no checkout
// of that branch. With a token and repository the commit is made through the API, which signs it.
// The branch carries a README of its own, added to the index alone, so the site directory (and
// so what any host serves from it) never holds it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_BRANCH, DIST_BRANCH, SITE, SITE_ORIGIN, SITE_REPOSITORY } from '../../src/lib/site-config.ts';
import { createClient } from './github.ts';
import type { Fetch } from './rest.ts';
import { runSync } from './run.ts';

export interface PublishOptions {
  // The repository checkout whose history the commit joins.
  repo: string;
  dir: string;
  // The source commit the build came from.
  sha: string;
  // Where the deploy ran and what it attested, written after Source in TRAILERS' order.
  trailers?: Trailers | undefined;
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

// The trailers a dist commit carries after its subject, in order, with what each names.
const TRAILERS = {
  Source: `The \`${DEFAULT_BRANCH}\` commit the build came from`,
  Run: 'The workflow run that deployed it and published this commit',
  'Archive-SHA256': 'The digest of the attested archive this tree was unpacked from',
  Attestation: "The archive's signed build provenance",
} as const;

type Trailers = Partial<Record<Exclude<keyof typeof TRAILERS, 'Source'>, string | undefined>>;

// The same text on every deploy, so an unchanged build still publishes nothing.
export const README = `# ${DIST_BRANCH}

The HTML, CSS, scripts and images [${SITE.domain}](${SITE_ORIGIN}) serves, one commit per deploy
that changed them. The [deploy workflow](https://github.com/${SITE_REPOSITORY}/blob/${DEFAULT_BRANCH}/.github/workflows/deploy.yml)
generates every commit from the build it shipped, so nothing here is edited by hand; the source
is [\`${DEFAULT_BRANCH}\`](https://github.com/${SITE_REPOSITORY}/tree/${DEFAULT_BRANCH}).

Each commit's trailers name its proof:

| Trailer | Names |
|---|---|
${Object.entries(TRAILERS)
  .map(([name, names]) => `| \`${name}\` | ${names} |`)
  .join('\n')}

To verify a deploy, download its archive (\`${SITE.domain}-<source>.tar.gz\` in the run's
\`release-<source>\` artifact, or a release's \`.tar.gz\`) and check it against its attestation:

\`\`\`sh
gh attestation verify <archive>.tar.gz -R ${SITE_REPOSITORY}
\`\`\`
`;

const BOT = { name: 'github-actions[bot]', email: '41898282+github-actions[bot]@users.noreply.github.com' };

export async function publishDist({ repo, dir, sha, trailers = {}, push = false, token, repository, fetch }: PublishOptions): Promise<Published> {
  const git = (args: string[], { cwd = repo, env, input }: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string } = {}) =>
    runSync('git', args, { cwd, env, input });

  const heads = git(['ls-remote', '--heads', 'origin', DIST_BRANCH]);
  if (heads) git(['fetch', '--quiet', '--depth=1', 'origin', DIST_BRANCH]);
  const parent = heads ? git(['rev-parse', 'FETCH_HEAD']) : undefined;

  using scratch = fs.mkdtempDisposableSync(path.join(os.tmpdir(), 'dist-index-'));
  const env = { GIT_DIR: git(['rev-parse', '--absolute-git-dir']), GIT_WORK_TREE: path.resolve(dir), GIT_INDEX_FILE: path.join(scratch.path, 'index') };
  git(['add', '--all', '--force', '.'], { cwd: dir, env });
  const readme = git(['hash-object', '-w', '--stdin'], { env, input: README });
  git(['update-index', '--add', '--cacheinfo', `100644,${readme},README.md`], { cwd: dir, env });
  const tree = git(['write-tree'], { cwd: dir, env });
  if (parent && git(['rev-parse', `${parent}^{tree}`]) === tree) return { status: 'unchanged', commit: parent };

  const identity = { GIT_AUTHOR_NAME: BOT.name, GIT_AUTHOR_EMAIL: BOT.email, GIT_COMMITTER_NAME: BOT.name, GIT_COMMITTER_EMAIL: BOT.email };
  const fields: Record<string, string | undefined> = { ...trailers, Source: sha };
  const message = [`deploy: ${sha.slice(0, 12)}`, '', ...Object.keys(TRAILERS).flatMap((key) => (fields[key] ? [`${key}: ${fields[key]}`] : []))].join('\n');
  const commit = git(['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', message], { env: identity });
  if (!push) return { status: 'committed', commit };

  // Through the environment, not argv, so the header never shows in a process listing.
  const auth = token
    ? {
        env: {
          GIT_CONFIG_COUNT: '1',
          GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
          GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`,
        },
      }
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
    if (!signed) throw new Error(`GitHub answered the commit of tree ${tree} with no sha; rerun the dist job`);
    if (parent) await api.request('PATCH', `/repos/${repository}/git/refs/heads/${DIST_BRANCH}`, { sha: signed });
    else await api.request('POST', `/repos/${repository}/git/refs`, { ref: `refs/heads/${DIST_BRANCH}`, sha: signed });
    return { status: 'pushed', commit: signed };
  } finally {
    git(['push', '--quiet', 'origin', `:${staging}`], auth);
  }
}
