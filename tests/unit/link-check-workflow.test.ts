import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { load } from 'js-yaml';
import { fromRoot } from '../../src/lib/site-root.ts';

// GitHub's path filter cannot read mise.toml, so the list is written out and held to vars.docs here.
test('a pull request that edits any doc the docs gates read runs the link check', () => {
  const docs = execFileSync('mise', ['config', 'get', '-f', fromRoot('mise.toml'), 'vars.docs'], { encoding: 'utf8' })
    .trim()
    .split(/\s+/)
    // A pathspec's magic prefix, such as :(glob), says how git matches; the path follows it.
    .map((spec) => spec.replaceAll("'", '').replace(/^:\([^)]*\)/, ''));
  const workflow = load(fs.readFileSync(fromRoot('.github/workflows/link-check.yml'), 'utf8')) as { on: { pull_request: { paths: string[] } } };
  const paths = workflow.on.pull_request.paths;
  for (const spec of docs) {
    const sample = spec.replaceAll('*', 'sample');
    assert.ok(
      paths.some((glob) => path.matchesGlob(sample, glob)),
      `${spec} is in vars.docs but not in link-check.yml's paths`,
    );
  }
});
