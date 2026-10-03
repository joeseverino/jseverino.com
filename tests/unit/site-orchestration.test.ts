// site publish and site land against a real git remote (a bare repository in
// a temp dir) and a stubbed gh on PATH. The sync and gate are injected; git is
// real, so branches, worktrees, pushes, and staged paths are what git says.
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { publish } from '../../bin/site/publish.ts';
import { land } from '../../bin/site/land.ts';
import { SiteError, createOutput } from '../../bin/site/cli.ts';
import { tempDir, write } from './helpers/fs.ts';

const out = createOutput({ quiet: true });
const NOW = new Date(2026, 9, 2, 14, 5);
const BRANCH = 'content/2026-10-02-1405';
const saved: Record<string, string | undefined> = {};
let tmp = '';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

// gh: logs every call and answers from a scenario file the test controls.
const GH_STUB = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.GH_STUB_LOG, args.join(' ') + '\\n');
const scenario = JSON.parse(fs.readFileSync(process.env.GH_STUB_SCENARIO, 'utf8'));
const save = () => fs.writeFileSync(process.env.GH_STUB_SCENARIO, JSON.stringify(scenario));
const [a, b] = args;
if (a === 'auth' && b === 'status') process.exit(0);
if (a === 'pr' && b === 'create') {
  if (scenario.prCreateFail) { console.error(scenario.prCreateFail); process.exit(1); }
  console.log('https://github.com/example/site/pull/7');
  process.exit(0);
}
if (a === 'pr' && b === 'view') { console.log(JSON.stringify(scenario.pr)); process.exit(0); }
if (a === 'pr' && b === 'merge') {
  scenario.pr = { ...scenario.pr, state: 'MERGED', mergeCommit: { oid: scenario.mergeSha } };
  save();
  process.exit(0);
}
if (a === 'api' && b.includes('/rules/branches/')) { console.log(JSON.stringify(scenario.rules ?? [])); process.exit(0); }
if (a === 'api' && b.includes('/commits/head/')) {
  // One entry per poll; the last repeats.
  const polls = scenario.headPolls ?? [[]];
  const runs = polls.length > 1 ? polls.shift() : polls[0];
  save();
  console.log(JSON.stringify({ check_runs: runs }));
  process.exit(0);
}
if (a === 'api') { console.log(JSON.stringify({ check_runs: scenario.checkRuns ?? [] })); process.exit(0); }
console.error('unexpected gh ' + args.join(' '));
process.exit(1);
`;

const ghCalls = () => fs.readFileSync(path.join(tmp, 'gh.log'), 'utf8').split('\n').filter(Boolean);
const scenario = (data: Record<string, unknown>) => fs.writeFileSync(path.join(tmp, 'scenario.json'), JSON.stringify(data));

// origin (bare) with two commits on main; a checkout on a stale branch cut
// from the first, never fetched since. Built once and copied back per test:
// the repos are slow to create and cheap to copy.
const REPOS = ['origin.git', 'seed', 'checkout'] as const;
let template = '';

function buildFixture(origin: string, seed: string, checkout: string): void {
  git(tmp, 'init', '--quiet', '--bare', '--initial-branch=main', origin);
  git(tmp, 'clone', '--quiet', origin, seed);
  write(path.join(seed, 'package-lock.json'), '{"packages":{}}\n');
  write(path.join(seed, '.gitignore'), 'node_modules\n');
  write(path.join(seed, 'src/content/writeups/old/index.mdx'), '---\ntitle: Old\n---\nOld body\n');
  git(seed, 'add', '-A');
  git(seed, 'commit', '--quiet', '-m', 'seed');
  git(seed, 'push', '--quiet', 'origin', 'main');

  git(tmp, 'clone', '--quiet', origin, checkout);
  git(checkout, 'switch', '--quiet', '-c', 'stale');
  write(path.join(checkout, 'node_modules/.package-lock.json'), '{"packages":{}}\n');

  write(path.join(seed, 'src/content/writeups/old/index.mdx'), '---\ntitle: Old\n---\nNewer body on main\n');
  git(seed, 'commit', '--quiet', '-am', 'main moves on');
  git(seed, 'push', '--quiet', 'origin', 'main');
}

function fixture() {
  const origin = path.join(tmp, 'origin.git');
  const seed = path.join(tmp, 'seed');
  const checkout = path.join(tmp, 'checkout');
  if (!template) {
    buildFixture(origin, seed, checkout);
    template = path.join(tmp, 'template');
    for (const name of REPOS) fs.cpSync(path.join(tmp, name), path.join(template, name), { recursive: true });
  } else {
    for (const name of REPOS) fs.cpSync(path.join(template, name), path.join(tmp, name), { recursive: true });
  }
  return { origin, seed, checkout };
}

// The injected sync: writes the files it reports, like the real one.
const syncWriting = (files: Record<string, string>, extra: Record<string, string> = {}) =>
  async ({ worktree }: { worktree: string }) => {
    for (const [file, content] of Object.entries({ ...files, ...extra })) write(path.join(worktree, file), content);
    return { written: Object.keys(files).sort(), removed: [] };
  };

const NEW_WRITEUP = {
  'src/content/writeups/new/index.mdx': '---\ntitle: New\n---\nBody\n',
  'src/content/writeups/new/images/a.png': 'png',
  'src/content/writeups/new/images/b.png': 'png',
};
const gate = async () => {};

before(() => {
  tmp = tempDir('site-orchestration-');
  const gitconfig = path.join(tmp, 'gitconfig');
  write(gitconfig, '[user]\n\tname = Test\n\temail = test@example.com\n[commit]\n\tgpgsign = false\n[tag]\n\tgpgsign = false\n[init]\n\tdefaultBranch = main\n');
  write(path.join(tmp, 'bin/gh'), GH_STUB);
  fs.chmodSync(path.join(tmp, 'bin/gh'), 0o755);
  fs.mkdirSync(path.join(tmp, 'vault/05 Writeups'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'vault/06 Pages'), { recursive: true });
  const env = {
    GIT_CONFIG_GLOBAL: gitconfig,
    GIT_CONFIG_NOSYSTEM: '1',
    PATH: `${path.join(tmp, 'bin')}${path.delimiter}${process.env.PATH}`,
    VAULT_DIR: path.join(tmp, 'vault'),
    GH_STUB_LOG: path.join(tmp, 'gh.log'),
    GH_STUB_SCENARIO: path.join(tmp, 'scenario.json'),
  };
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
});

after(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  for (const entry of ['origin.git', 'seed', 'checkout', 'gh.log']) fs.rmSync(path.join(tmp, entry), { recursive: true, force: true });
  fs.writeFileSync(path.join(tmp, 'gh.log'), '');
  scenario({});
});

describe('site publish', () => {
  test('cuts from origin/main whatever the checkout is on, and commits exactly the declared outputs', async () => {
    const { origin, checkout } = fixture();
    const before = git(checkout, 'rev-parse', 'HEAD');
    const result = await publish({ root: checkout, out, now: NOW, sync: syncWriting(NEW_WRITEUP), gate });

    assert.equal(result.status, 'pr-opened');
    assert.equal(result.pr, 'https://github.com/example/site/pull/7');
    assert.deepEqual(result.diff.published, ['new']);
    assert.equal(result.message, 'content: publish new');

    // The pushed commit sits on the current origin/main, whatever the checkout's branch.
    assert.equal(git(origin, 'rev-parse', `${BRANCH}^`), git(origin, 'rev-parse', 'main'));
    assert.deepEqual(git(origin, 'diff-tree', '--no-commit-id', '--name-only', '-r', BRANCH).split('\n').sort(), Object.keys(NEW_WRITEUP).sort());

    // The checkout is untouched: same branch, same HEAD, no branch or worktree left behind.
    assert.equal(git(checkout, 'branch', '--show-current'), 'stale');
    assert.equal(git(checkout, 'rev-parse', 'HEAD'), before);
    assert.equal(git(checkout, 'branch', '--list', 'content/*'), '');
    assert.equal(git(checkout, 'worktree', 'list').split('\n').length, 1);

    const calls = ghCalls();
    assert.ok(calls.some((call) => call.startsWith('pr create --base main --head content/2026-10-02-1405')));
    assert.ok(!calls.some((call) => call.startsWith('pr merge')), 'publish never merges');
  });

  test('nothing changed: says so, pushes nothing, opens nothing', async () => {
    const { origin, checkout } = fixture();
    const result = await publish({
      root: checkout, out, now: NOW, gate,
      sync: syncWriting({ 'src/content/writeups/old/index.mdx': '---\ntitle: Old\n---\nNewer body on main\n' }),
    });
    assert.equal(result.status, 'nothing-to-publish');
    assert.equal(git(origin, 'branch', '--list', 'content/*'), '');
    assert.ok(!ghCalls().some((call) => call.startsWith('pr ')));
    assert.equal(git(checkout, 'branch', '--list', 'content/*'), '');
  });

  test('a gh failure is fatal, carries its stderr, and names the pushed branch', async () => {
    const { origin, checkout } = fixture();
    scenario({ prCreateFail: 'GraphQL: Resource not accessible by integration' });
    await assert.rejects(
      publish({ root: checkout, out, now: NOW, sync: syncWriting(NEW_WRITEUP), gate }),
      (error: SiteError) => {
        assert.match(error.message, /gh pr create failed/);
        assert.match(error.message, /Resource not accessible by integration/);
        assert.match(error.message, /origin\/content\/2026-10-02-1405 was pushed and is still on the remote/);
        assert.equal(error.code, 1);
        assert.equal((error.result as { remoteBranch: string }).remoteBranch, BRANCH);
        assert.match(error.fix ?? '', /git push origin --delete content\/2026-10-02-1405/);
        return true;
      },
    );
    assert.equal(git(checkout, 'branch', '--list', 'content/*'), '');
    assert.notEqual(git(origin, 'branch', '--list', BRANCH), '', 'the pushed branch is what the error names');
  });

  test('a cleanup failure is reported beside the error that ended the publish', async () => {
    const { checkout } = fixture();
    const sync = async ({ worktree }: { worktree: string }) => {
      // A worktree git no longer recognizes: `git worktree remove` fails.
      fs.writeFileSync(path.join(worktree, '.git'), 'gitdir: /nonexistent\n');
      throw new SiteError('sync exploded');
    };
    await assert.rejects(publish({ root: checkout, out, now: NOW, gate, sync }), (error: SiteError) => {
      assert.equal(error.message, 'sync exploded');
      const { cleanup } = error.result as { cleanup: string[] };
      assert.equal(cleanup.length, 1);
      assert.match(cleanup[0] ?? '', /^removing the worktree failed .*git worktree prune/);
      return true;
    });
    // The later steps still ran: no branch or worktree is left.
    assert.equal(git(checkout, 'branch', '--list', 'content/*'), '');
    assert.equal(git(checkout, 'worktree', 'list').split('\n').length, 1);
  });

  test('--dry-run commits in the worktree, then leaves no branch, worktree, or push', async () => {
    const { origin, checkout } = fixture();
    const result = await publish({ root: checkout, out, now: NOW, dryRun: true, sync: syncWriting(NEW_WRITEUP), gate });
    assert.equal(result.status, 'dry-run');
    assert.match(result.commit, /^[0-9a-f]{40}$/);
    assert.match(result.body, /\*\*Published\*\*/);
    assert.match(result.body, /2 generated files/);
    assert.equal(git(checkout, 'branch', '--list', 'content/*'), '');
    assert.equal(git(checkout, 'worktree', 'list').split('\n').length, 1);
    assert.equal(git(origin, 'branch', '--list', 'content/*'), '');
    assert.deepEqual(ghCalls(), [], 'a dry run needs no gh at all');
  });

  test('a file the sync wrote but did not declare stops the publish', async () => {
    const { origin, checkout } = fixture();
    await assert.rejects(
      publish({ root: checkout, out, now: NOW, gate, sync: syncWriting(NEW_WRITEUP, { 'src/lib/stray.json': '{}' }) }),
      /did not declare: src\/lib\/stray\.json/,
    );
    assert.equal(git(origin, 'branch', '--list', 'content/*'), '');
  });

  test('preflight stops before any work when the checkout has uncommitted tracked changes', async () => {
    const { checkout } = fixture();
    write(path.join(checkout, 'package-lock.json'), '{"packages":{},"dirty":true}\n');
    let synced = false;
    await assert.rejects(
      publish({ root: checkout, out, now: NOW, gate, sync: async () => { synced = true; return { written: [], removed: [] }; } }),
      (error: Error & { code: number }) => error.code === 3 && /preflight failed: clean/.test(error.message),
    );
    assert.equal(synced, false);
  });
});

const rules = (...contexts: string[]) => [
  { type: 'pull_request', parameters: {} },
  { type: 'required_status_checks', parameters: { required_status_checks: contexts.map((context) => ({ context })) } },
];
const run = (name: string, status: string, conclusion: string | null = null) => ({ name, status, conclusion, details_url: 'https://ci.example' });
const OPEN_PR = { number: 7, url: 'u', title: 't', state: 'OPEN', headRefName: BRANCH, headRefOid: 'head', isDraft: false };
const headPolls = () => ghCalls().filter((call) => call.includes('/commits/head/')).length;

describe('site land', () => {
  test('waits for every required check, merges, waits for the deploy, verifies published and removed slugs', async () => {
    const { seed, checkout } = fixture();
    // The squash-merge commit as it lands on main.
    write(path.join(seed, 'src/content/writeups/new/index.mdx'), '---\ntitle: New\n---\nBody\n');
    fs.rmSync(path.join(seed, 'src/content/writeups/old'), { recursive: true });
    git(seed, 'add', '-A');
    git(seed, 'commit', '--quiet', '-m', 'content: publish 1, remove 1');
    git(seed, 'push', '--quiet', 'origin', 'main');
    const mergeSha = git(seed, 'rev-parse', 'HEAD');
    scenario({
      pr: { ...OPEN_PR, url: 'https://github.com/example/site/pull/7', title: 'content: publish 1, remove 1' },
      mergeSha,
      rules: rules('build', 'e2e'),
      // A fresh PR: nothing reported, then one running, then both green.
      headPolls: [[], [run('build', 'in_progress')], [run('build', 'completed', 'success'), run('e2e', 'completed', 'success')]],
      checkRuns: [{ name: 'Cloudflare Pages', status: 'completed', conclusion: 'success', details_url: 'https://dash.example' }],
    });

    const verified: string[] = [];
    const result = await land({
      root: checkout, pr: '7', out, intervalMs: 1,
      verify: async (slug: string) => { verified.push(slug); return { ok: true }; },
      gone: async () => ({ ok: true, status: 404 }),
      hq: async () => ({ ran: false }),
    });

    assert.equal(result.status, 'landed');
    assert.equal(result.sha, mergeSha);
    assert.deepEqual(verified, ['new']);
    assert.deepEqual(result.verified.map((entry: { slug: string }) => entry.slug), ['new', 'old']);
    const calls = ghCalls();
    assert.equal(headPolls(), 3, 'polled until both required checks reported and passed');
    const order = ['api repos/joeseverino/jseverino.com/rules/branches/main', 'pr merge 7 --squash', `api repos/joeseverino/jseverino.com/commits/${mergeSha}`]
      .map((prefix) => calls.findIndex((call) => call.startsWith(prefix)));
    assert.ok(order.every((index, i) => index >= 0 && (i === 0 || index > (order[i - 1] ?? -1))), calls.join('\n'));
    assert.ok(calls.findLastIndex((call) => call.includes('/commits/head/')) < calls.findIndex((call) => call.startsWith('pr merge')));
  });

  test('a fresh PR with no checks reported yet waits; it never merges on an empty report', async () => {
    const { checkout } = fixture();
    scenario({ pr: OPEN_PR, rules: rules('build'), headPolls: [[]] });
    await assert.rejects(
      land({ root: checkout, pr: '7', out, intervalMs: 1, timeoutMs: 500 }),
      (error: Error & { code: number }) => error.code === 4 && /timed out waiting for the required checks/.test(error.message),
    );
    assert.ok(headPolls() > 1);
    assert.ok(!ghCalls().some((call) => call.startsWith('pr merge')));
  });

  test('a required context that never reports blocks the merge, even with the others green', async () => {
    const { checkout } = fixture();
    scenario({ pr: OPEN_PR, rules: rules('build', 'edge'), headPolls: [[run('build', 'completed', 'success')]] });
    await assert.rejects(land({ root: checkout, pr: '7', out, intervalMs: 1, timeoutMs: 40 }), /timed out waiting for the required checks/);
    assert.ok(!ghCalls().some((call) => call.startsWith('pr merge')));
  });

  test('a ruleset with no required checks is an error', async () => {
    const { checkout } = fixture();
    scenario({ pr: OPEN_PR, rules: [{ type: 'pull_request', parameters: {} }] });
    await assert.rejects(land({ root: checkout, pr: '7', out, intervalMs: 1 }), /requires no status checks/);
    assert.equal(headPolls(), 0);
    assert.ok(!ghCalls().some((call) => call.startsWith('pr merge')));
  });

  test('a failing required check stops before the merge without waiting for the rest', async () => {
    const { checkout } = fixture();
    scenario({ pr: OPEN_PR, rules: rules('build', 'e2e'), headPolls: [[run('build', 'completed', 'failure'), run('e2e', 'in_progress')]] });
    await assert.rejects(land({ root: checkout, pr: '7', out, intervalMs: 1 }), /required checks failed on #7: build=failure, e2e=in_progress/);
    assert.equal(headPolls(), 1);
    assert.ok(!ghCalls().some((call) => call.startsWith('pr merge')));
  });

  test('a deploy that never completes times out with exit code 4', async () => {
    const { seed, checkout } = fixture();
    const mergeSha = git(seed, 'rev-parse', 'HEAD');
    scenario({
      pr: { ...OPEN_PR, state: 'MERGED', mergeCommit: { oid: mergeSha } },
      checkRuns: [{ name: 'Cloudflare Pages', status: 'in_progress' }],
    });
    await assert.rejects(
      land({ root: checkout, pr: '7', out, intervalMs: 5, timeoutMs: 50 }),
      (error: Error & { code: number }) => error.code === 4 && /timed out waiting for Cloudflare Pages/.test(error.message),
    );
  });
});
