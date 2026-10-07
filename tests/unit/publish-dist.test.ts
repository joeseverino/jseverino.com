import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { publishDist, routeFile } from '../../bin/lib/dist.ts';
import { git } from '../../bin/lib/git.ts';
import { runSync } from '../../bin/lib/run.ts';

let root: string;
let origin: string;
let repo: string;
let site: string;

const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(site, file)), { recursive: true });
  fs.writeFileSync(path.join(site, file), text);
};
const head = () => git(repo, 'rev-parse', 'HEAD');
const publish = (push = true) => publishDist({ repo, dir: site, branch: 'dist', sha: head(), push });
const tree = () => git(origin, 'ls-tree', '-r', '--name-only', 'dist').split('\n');

// The API calls the publisher makes, run against the bare origin. The commit comes back from an
// identity the publisher never set, as a signed API commit does.
const API_IDENTITY = { GIT_AUTHOR_NAME: 'api', GIT_AUTHOR_EMAIL: 'api@example.com', GIT_COMMITTER_NAME: 'api', GIT_COMMITTER_EMAIL: 'api@example.com' };
const apiCalls: { method: string; route: string }[] = [];
const fakeApi = async (url: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body)) as { message: string; tree: string; parents: string[]; ref?: string; sha: string };
  const route = new URL(url).pathname.replace('/repos/joeseverino/jseverino.com', '');
  apiCalls.push({ method: init.method ?? 'GET', route });
  if (route === '/git/commits') {
    const parents = body.parents.flatMap((parent) => ['-p', parent]);
    const sha = runSync('git', ['commit-tree', body.tree, ...parents, '-m', body.message], { cwd: origin, env: API_IDENTITY });
    return new Response(JSON.stringify({ sha }), { status: 201 });
  }
  git(origin, 'update-ref', body.ref ?? route.replace('/git/refs/', 'refs/'), body.sha);
  return new Response('{}', { status: 200 });
};
const publishSigned = () =>
  publishDist({ repo, dir: site, branch: 'dist', sha: head(), push: true, token: 'token', repository: 'joeseverino/jseverino.com', fetch: fakeApi });

beforeEach(() => {
  apiCalls.length = 0;
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-dist-'));
  origin = path.join(root, 'origin.git');
  repo = path.join(root, 'repo');
  site = path.join(root, 'site');
  git(root, 'init', '--bare', '--quiet', '-b', 'main', origin);
  git(root, 'init', '--quiet', '-b', 'main', repo);
  git(repo, 'remote', 'add', 'origin', origin);
  git(repo, 'config', 'core.hooksPath', '/dev/null');
  fs.writeFileSync(path.join(repo, 'README.md'), 'source\n');
  git(repo, 'add', '.');
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '--quiet', '-m', 'source');
  write('index.html', '<h1>home</h1>');
  write('about/index.html', '<h1>about</h1>');
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

test('a route maps to the file it is served from', () => {
  assert.equal(routeFile('/'), 'index.html');
  assert.equal(routeFile('/about/'), 'about/index.html');
  assert.equal(routeFile('/portfolio/building-a-homelab/'), 'portfolio/building-a-homelab/index.html');
  assert.equal(routeFile('/resume.pdf'), 'resume.pdf');
});

describe('publishDist', () => {
  test('creates the branch from the directory alone', async () => {
    const result = await publish();
    assert.equal(result.status, 'pushed');
    assert.deepEqual(tree(), ['about/index.html', 'index.html']);
    assert.equal(git(origin, 'rev-list', '--count', 'dist'), '1');
    assert.match(git(origin, 'log', '-1', '--format=%B', 'dist'), new RegExp(`Source: ${head()}`));
  });

  test('publishes ignored files and leaves the source checkout alone', async () => {
    fs.writeFileSync(path.join(repo, '.gitignore'), '*.map\n');
    write('app.js.map', '{}');
    await publish();
    assert.ok(tree().includes('app.js.map'));
    assert.equal(git(repo, 'branch', '--show-current'), 'main');
    assert.equal(git(repo, 'status', '--porcelain'), '?? .gitignore');
  });

  test('an unchanged build makes no commit', async () => {
    await publish();
    assert.equal((await publish()).status, 'unchanged');
    assert.equal(git(origin, 'rev-list', '--count', 'dist'), '1');
  });

  test('a changed build adds one commit and drops removed files', async () => {
    await publish();
    write('index.html', '<h1>home v2</h1>');
    fs.rmSync(path.join(site, 'about'), { recursive: true });
    assert.equal((await publish()).status, 'pushed');
    assert.equal(git(origin, 'rev-list', '--count', 'dist'), '2');
    assert.deepEqual(tree(), ['index.html']);
  });

  test('without push the commit stays local', async () => {
    assert.equal((await publish(false)).status, 'committed');
    assert.equal(git(origin, 'branch', '--list', 'dist'), '');
  });

  test('refuses a branch name it should not publish to', async () => {
    await assert.rejects(publishDist({ repo, dir: site, branch: '--force', sha: 'abc' }), /not a publishable branch name/);
  });
});

describe('publishDist through the API', () => {
  test('the commit on the branch is the API commit, and the staging ref is gone', async () => {
    const result = await publishSigned();
    assert.equal(git(origin, 'rev-parse', 'dist'), result.commit);
    assert.equal(git(origin, 'log', '-1', '--format=%an', 'dist'), 'api', 'made by the API, not by a local identity');
    assert.deepEqual(tree(), ['about/index.html', 'index.html']);
    assert.equal(git(origin, 'for-each-ref', 'refs/dist-staging'), '');
    assert.deepEqual(apiCalls.map((call) => `${call.method} ${call.route}`), ['POST /git/commits', 'POST /git/refs']);
  });

  test('a later publish names the branch tip as its parent and moves the ref', async () => {
    const first = await publishSigned();
    write('index.html', '<h1>home v2</h1>');
    apiCalls.length = 0;
    const second = await publishSigned();
    assert.equal(git(origin, 'rev-parse', `${second.commit}^`), first.commit);
    assert.deepEqual(apiCalls.map((call) => `${call.method} ${call.route}`), ['POST /git/commits', 'PATCH /git/refs/heads/dist']);
  });

  test('an unchanged build makes no API call', async () => {
    await publishSigned();
    apiCalls.length = 0;
    assert.equal((await publishSigned()).status, 'unchanged');
    assert.deepEqual(apiCalls, []);
  });

  test('a failed API call still removes the staging ref', async () => {
    const failing = (): Promise<Response> => Promise.resolve(new Response('{"message":"nope"}', { status: 500 }));
    await assert.rejects(
      publishDist({ repo, dir: site, branch: 'dist', sha: head(), push: true, token: 'token', repository: 'joeseverino/jseverino.com', fetch: failing }),
      /500/,
    );
    assert.equal(git(origin, 'for-each-ref', 'refs/dist-staging'), '');
  });
});
