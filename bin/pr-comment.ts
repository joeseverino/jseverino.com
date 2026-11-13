// The one ci comment on a pull request, created or updated in place: the required checks'
// states, ci's job summaries and the preview's, for the workflow_run event the preview
// workflow's report job runs on. See .github/workflows/preview.yml.
//
// GitHub Actions supplies the event (GITHUB_EVENT_PATH), GITHUB_REPOSITORY and the token
// (GITHUB_TOKEN); PREVIEW is the preview job's result.

import fs from 'node:fs';
import path from 'node:path';
import { readJson } from '../src/lib/json.ts';
import { cli, exitWith } from './lib/args.ts';
import { type CheckRun, checkRuns, createClient, passed, requiredContexts } from './lib/github.ts';
import type { Fetch } from './lib/rest.ts';

const USAGE = 'usage: node bin/pr-comment.ts [summaries]';

// Finds the comment again on the next run.
export const MARKER = '<!-- ci-summary -->';

// ci's summary artifacts (summary-<name>.md), each named for the check its job reports, in the
// order the comment shows them.
const CI_SUMMARIES = ['build', 'e2e', 'visual', 'edge'];

export interface WorkflowRun {
  head_sha: string;
  conclusion: string | null;
  html_url: string;
}

export interface CommentInput {
  run: WorkflowRun;
  // The preview job's result: success, failure, cancelled or skipped.
  preview: string;
  // Summary text by artifact name; a missing one was never written.
  summaries: Partial<Record<string, string>>;
  required: readonly string[];
  checks: readonly Pick<CheckRun, 'name' | 'status' | 'conclusion' | 'details_url'>[];
}

// A job summary's sections sit one level below the comment's own. A passing job's sections fold
// each to its title and its first paragraph, the one-line result every summary writer leads with;
// a <summary> renders no Markdown, so its inline code becomes HTML. A failing job's stay open.
function nested(summary: string | undefined, passing: boolean): string | undefined {
  const text = summary?.trim().replace(/^## /gm, '### ');
  if (!passing || !text) return text;
  return text
    .split(/\n(?=### )/)
    .map((raw) => {
      const part = raw.trim();
      const [, title, headline = '', rest] = part.match(/^### (.+)\n\n(.+)\n\n([\s\S]+)$/) ?? [];
      if (!rest) return part;
      const line = headline.replace(/`([^`]+)`/g, '<code>$1</code>');
      return `<details><summary><b>${title}</b>: ${line}</summary>\n\n${rest.trim()}\n\n</details>`;
    })
    .join('\n\n');
}

export function commentBody({ run, preview, summaries, required, checks }: CommentInput): string {
  const check = (name: string) => checks.find((candidate) => candidate.name === name);
  const status = required
    .map((name) => {
      const found = check(name);
      if (!found) return `\`${name}\` pending`;
      return `[\`${name}\`](${found.details_url}) ${found.conclusion ?? found.status}`;
    })
    .join(' · ');
  const ci = [
    `### ci: ${run.conclusion} · [run](${run.html_url})`,
    ...CI_SUMMARIES.flatMap((name) => {
      const found = check(name);
      return nested(summaries[name], found !== undefined && passed(found)) ?? [];
    }),
  ].join('\n\n');
  const deploy =
    preview === 'skipped'
      ? `### Deploy\n\nNothing deployed: ci ${run.conclusion}.`
      : (nested(summaries.deploy, preview === 'success') ?? `### Deploy\n\n${preview}: no summary was produced.`);
  return [MARKER, `## CI for \`${run.head_sha.slice(0, 12)}\``, '', status, '', ci, '', deploy, ''].join('\n');
}

const readSummaries = (dir: string): Partial<Record<string, string>> =>
  Object.fromEntries(
    [...CI_SUMMARIES, 'deploy'].flatMap((name) => {
      const file = path.join(dir, `summary-${name}.md`);
      return fs.existsSync(file) ? [[name, fs.readFileSync(file, 'utf8')]] : [];
    }),
  );

interface Pull {
  number: number;
  state: string;
  head: { sha: string; repo: { full_name: string } | null };
}

interface Comment {
  id: number;
  body?: string;
}

export interface MainOptions {
  env?: NodeJS.ProcessEnv;
  fetch?: Fetch;
  dir?: string | undefined;
  log?: (line: string) => void;
}

export async function main({ env = process.env, fetch, dir = 'summaries', log = console.log }: MainOptions = {}): Promise<number> {
  const { GITHUB_REPOSITORY: repository, GITHUB_EVENT_PATH: eventPath, PREVIEW: preview } = env;
  if (!repository || !eventPath || !preview) throw new Error('GITHUB_REPOSITORY, GITHUB_EVENT_PATH and PREVIEW must be set');
  // The default branch is on the event's own repository; workflow_run.repository is the minimal form without it.
  const { workflow_run: run, repository: eventRepository } = readJson<{
    workflow_run: WorkflowRun;
    repository?: { default_branch?: string };
  }>(eventPath);
  const defaultBranch = eventRepository?.default_branch;
  if (!defaultBranch) throw new Error('the event has no repository.default_branch');
  const github = createClient({ token: env.GITHUB_TOKEN, fetch });
  const sha = run.head_sha;

  // Only the open pull request whose head is this commit, from this repository.
  const pull = (await github.list<Pull>(`/repos/${repository}/commits/${sha}/pulls?per_page=100`)).find(
    (candidate) => candidate.state === 'open' && candidate.head.sha === sha && candidate.head.repo?.full_name === repository,
  );
  if (!pull) {
    log(`No open pull request has ${sha} as its head; nothing to comment on.`);
    return 0;
  }

  const [required, checks] = await Promise.all([requiredContexts(repository, defaultBranch, github), checkRuns(repository, sha, github)]);
  const body = commentBody({ run, preview, summaries: readSummaries(dir), required, checks });
  const existing = (await github.list<Comment>(`/repos/${repository}/issues/${pull.number}/comments?per_page=100`)).find((comment) =>
    comment.body?.includes(MARKER),
  );
  if (existing) await github.request('PATCH', `/repos/${repository}/issues/comments/${existing.id}`, { body });
  else await github.request('POST', `/repos/${repository}/issues/${pull.number}/comments`, { body });
  log(`${existing ? 'Updated' : 'Posted'} the ci comment on #${pull.number}.`);
  return 0;
}

if (import.meta.main) {
  const [dir, ...extra] = cli({ usage: USAGE, allowPositionals: true }).positionals;
  if (extra.length) {
    console.error(USAGE);
    process.exit(2);
  }
  await exitWith('pr-comment', () => main({ dir }));
}
