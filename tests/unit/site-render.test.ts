// site render: the build's renderer over a vault writeup or stdin.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { render } from '../../bin/site/render.ts';
import { renderMarkdown } from '../../bin/lib/render.ts';
import { SiteError, createOutput } from '../../bin/site/cli.ts';
import { tempDir, write } from './helpers/fs.ts';

const out = createOutput({ quiet: true });
const MARKDOWN = '---\ntitle: Demo\npublished: false\n---\n\n## Setup\n\nRun **this** first.\n';
let vault = '';
let saved: string | undefined;

before(() => {
  vault = tempDir('site-render-');
  write(path.join(vault, '05 Writeups', 'demo-writeup', 'index.md'), MARKDOWN);
  saved = process.env.VAULT_DIR;
  process.env.VAULT_DIR = vault;
});

after(() => {
  if (saved === undefined) delete process.env.VAULT_DIR;
  else process.env.VAULT_DIR = saved;
  fs.rmSync(vault, { recursive: true, force: true });
});

describe('site render', () => {
  test('renders a vault writeup body without its frontmatter', async () => {
    const result = await render({ slug: 'demo-writeup', out });
    assert.equal(result.slug, 'demo-writeup');
    assert.equal(result.source, path.join(vault, '05 Writeups', 'demo-writeup', 'index.md'));
    assert.match(result.html, /<strong>this<\/strong>/);
    assert.doesNotMatch(result.html, /title: Demo/);
    assert.equal(result.next, null);
  });

  test('matches the library render the build and tests share', async () => {
    const result = await render({ slug: 'demo-writeup', out });
    assert.equal(result.html, renderMarkdown('## Setup\n\nRun **this** first.\n').html);
  });

  test('renders markdown from stdin with -', async () => {
    const result = await render({ slug: '-', out, stdin: () => MARKDOWN });
    assert.equal(result.slug, null);
    assert.equal(result.source, 'stdin');
    assert.match(result.html, /<strong>this<\/strong>/);
  });

  test('refuses a missing writeup and a malformed slug', async () => {
    await assert.rejects(render({ slug: 'no-such-writeup', out }), SiteError);
    await assert.rejects(render({ slug: 'Bad Slug', out }), SiteError);
  });
});
