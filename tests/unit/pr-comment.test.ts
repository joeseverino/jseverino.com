import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { API_BASE } from '../../bin/lib/github.ts';
import { MARKER, commentBody, main, type CommentInput, type WorkflowRun } from '../../bin/pr-comment.ts';
import { scratchDirs } from './helpers/fs.ts';

const REPO = 'example/site';
const SHA = '0123456789abcdef0123456789abcdef01234567';
const run: WorkflowRun = {
  head_sha: SHA,
  conclusion: 'success',
  html_url: 'https://github.example/runs/1',
};
const input = (fields: Partial<CommentInput> = {}): CommentInput =>
  ({ run, preview: 'success', summaries: {}, required: [], checks: [], ...fields });

describe('commentBody', () => {
  test('opens with the marker and the commit', () => {
    const lines = commentBody(input()).split('\n');
    assert.equal(lines[0], MARKER);
    assert.equal(lines[1], '## CI for `0123456789ab`');
  });

  test('gives each required check its conclusion, its status while running, or pending before it starts', () => {
    const body = commentBody(input({
      required: ['build', 'e2e', 'deploy'],
      checks: [
        { name: 'build', status: 'completed', conclusion: 'failure' },
        { name: 'e2e', status: 'in_progress', conclusion: null },
      ],
    }));
    assert.match(body, /^`build` failure · `e2e` in_progress · `deploy` pending$/m);
  });

  test('nests ci\'s summaries under its run in a fixed order, leaving out the missing', () => {
    const body = commentBody(input({ summaries: { edge: '## Edge runtime\n\nok\n', e2e: '## Cross-browser suite\n\nok' } }));
    const ci = '### ci: success · [run](https://github.example/runs/1)\n\n### Cross-browser suite\n\nok\n\n### Edge runtime\n\nok';
    assert.ok(body.includes(ci), body);
  });

  test('the deploy section is the preview\'s summary, a reason when the preview never ran, or the result when it wrote none', () => {
    assert.match(commentBody(input({ summaries: { deploy: '## Deploy\n\nat https://preview.example' } })), /### Deploy\n\nat https:\/\/preview\.example\n$/);
    assert.match(commentBody(input({ preview: 'skipped', run: { ...run, conclusion: 'failure' } })), /### Deploy\n\nNothing deployed: ci failure\.\n$/);
    assert.match(commentBody(input({ preview: 'failure' })), /### Deploy\n\nfailure: no summary was produced\.\n$/);
  });
});

describe('main', () => {
  interface Pull { number: number; state: string; head: { sha: string; repo: { full_name: string } | null } }
  const scratch = scratchDirs('pr-comment-');
  after(scratch.cleanup);
  const ours: Pull = { number: 7, state: 'open', head: { sha: SHA, repo: { full_name: REPO } } };

  // workflow_run.repository is the minimal repository; default_branch is only on the top-level one.
  const event = { workflow_run: { ...run, repository: { full_name: REPO } }, repository: { full_name: REPO, default_branch: 'main' } };

  function setup(pulls: Pull[], comments: { id: number; body: string }[]) {
    const dir = scratch.make();
    const eventPath = path.join(dir, 'event.json');
    fs.writeFileSync(eventPath, JSON.stringify(event));
    fs.writeFileSync(path.join(dir, 'summary-e2e.md'), '## Cross-browser suite\n\nok');
    const writes: { method: string; path: string; body: { body: string } }[] = [];
    const routes: Record<string, unknown> = {
      [`/repos/${REPO}/commits/${SHA}/pulls`]: pulls,
      [`/repos/${REPO}/issues/7/comments`]: comments,
      [`/repos/${REPO}/rules/branches/main`]: [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'build' }] } }],
      [`/repos/${REPO}/commits/${SHA}/check-runs`]: { check_runs: [{ name: 'build', status: 'completed', conclusion: 'success' }] },
    };
    const fetch = async (url: string, init: RequestInit): Promise<Response> => {
      const { pathname } = new URL(url);
      assert.ok(url.startsWith(API_BASE), url);
      if (init.method !== 'GET') {
        writes.push({ method: String(init.method), path: pathname, body: JSON.parse(String(init.body)) });
        return new Response('{}', { status: 200 });
      }
      assert.ok(pathname in routes, `unexpected GET ${pathname}`);
      return new Response(JSON.stringify(routes[pathname]), { status: 200 });
    };
    const lines: string[] = [];
    const go = () => main({
      env: { GITHUB_REPOSITORY: REPO, GITHUB_EVENT_PATH: eventPath, GITHUB_TOKEN: 'token', PREVIEW: 'skipped' },
      fetch,
      dir,
      log: (line) => lines.push(line),
    });
    return { go, writes, lines, eventPath };
  }

  test('posts the comment when the pull request has none', async () => {
    const { go, writes } = setup([ours], [{ id: 1, body: 'a review' }]);
    assert.equal(await go(), 0);
    assert.equal(writes.length, 1);
    assert.equal(writes[0]?.method, 'POST');
    assert.equal(writes[0]?.path, `/repos/${REPO}/issues/7/comments`);
    assert.ok(writes[0]?.body.body.includes('`build` success'));
    assert.ok(writes[0]?.body.body.includes('### Cross-browser suite'));
  });

  test('fails naming the field when the event carries no default branch', async () => {
    const { go, eventPath } = setup([ours], []);
    fs.writeFileSync(eventPath, JSON.stringify({ ...event, repository: { full_name: REPO } }));
    await assert.rejects(go(), /repository\.default_branch/);
  });

  test('updates its own comment in place', async () => {
    const { go, writes } = setup([ours], [{ id: 1, body: 'a review' }, { id: 2, body: `${MARKER}\nold` }]);
    await go();
    assert.deepEqual(writes.map(({ method, path }) => `${method} ${path}`), [`PATCH /repos/${REPO}/issues/comments/2`]);
  });

  test('writes nothing unless an open pull request from this repository has the commit as its head', async () => {
    const { go, writes, lines } = setup([
      { ...ours, state: 'closed' },
      { ...ours, head: { sha: 'f'.repeat(40), repo: { full_name: REPO } } },
      { ...ours, head: { sha: SHA, repo: { full_name: 'fork/site' } } },
    ], []);
    assert.equal(await go(), 0);
    assert.deepEqual(writes, []);
    assert.match(lines.join('\n'), /nothing to comment on/);
  });
});
