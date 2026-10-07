import { after, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  WriteupError, applyPlan, featuredOrder, listWriteups, loadWriteups, prepare, reorderFeatured, snapshot, tagUsage,
  technologyCatalog, updateFrontmatter, updateLink, type WriteupStore,
} from '../../bin/lib/writeups/store.ts';
import { renderScalar, replaceScalar, yamlEscape } from '../../bin/lib/writeups/scalar.ts';
import { scratchDirs, write } from './helpers/fs.ts';

const READY = `---
title: Ready Piece
description: A short, concrete description for the ready piece.
published: true
published_at: 2026-05-29
last_reviewed: 2026-05-29
cover_image: ./images/cover.png
cover_alt: A diagram of the lab
technologies:
  - docker
  - python
featured: true
featured_order: 2
---
# Ready Piece

![hero](./images/cover.png)

See [the docs](https://example.com/old "Old docs") for more.
`;

const DRAFT = `---
title: Draft Piece
description: ""
published: false
published_at:
last_reviewed: 2026-05-20
cover_image: ./images/cover.png
technologies:
  - docker
  - made-up-slug
featured: false
featured_order:
---
# Draft Piece
`;

const LEAD = `---
title: Lead Piece
description: Leads the featured order.
published: true
published_at: 2026-05-01
technologies:
  - docker
featured: true
featured_order: 1
---
# Lead Piece
`;

const CATALOG = `# Technology Groups

## Platforms & OS

| Slug | Label | Featured |
| --- | --- | --- |
| docker | Docker | yes |

## Languages

| Slug | Label | Featured |
| --- | --- | --- |
| python | Python | yes |
| yaml | YAML |  |
`;

const scratch = scratchDirs('writeup-store-');
let store: WriteupStore;
const file = (slug: string): string => path.join(store.writeupsDir, slug, 'index.md');
const read = (slug: string): string => fs.readFileSync(file(slug), 'utf8');

beforeEach(() => {
  const root = scratch.make();
  store = { vaultRoot: root, writeupsDir: path.join(root, '05 Writeups'), catalogPath: path.join(root, '06 Pages', '_technology-groups.md') };
  write(file('ready-piece'), READY);
  write(path.join(store.writeupsDir, 'ready-piece', 'images', 'cover.png'), 'png');
  write(file('draft-piece'), DRAFT);
  write(file('lead-piece'), LEAD);
  write(path.join(store.writeupsDir, 'bare-folder', 'index.md'), '# Just a title\n\nNo frontmatter.\n');
  write(store.catalogPath, CATALOG);
});

after(scratch.cleanup);

describe('scalar writes', () => {
  test('quote only what the vault YAML subset needs', () => {
    assert.equal(yamlEscape('plain text'), 'plain text');
    assert.equal(yamlEscape('Notes on [arrays], colons: and commas'), '"Notes on [arrays], colons: and commas"');
    assert.equal(yamlEscape(' padded'), '" padded"');
    assert.equal(renderScalar(null), '');
    assert.equal(renderScalar(true), 'true');
    assert.equal(renderScalar(3), '3');
  });

  test('a missing key is inserted before the closing fence', () => {
    assert.equal(replaceScalar('---\ntitle: A\n---\nbody\n', 'cover_alt', 'x'), '---\ntitle: A\ncover_alt: x\n---\nbody\n');
  });
});

describe('reads', () => {
  test('skip folders without frontmatter and coerce typed fields', () => {
    const writeups = loadWriteups(store);
    assert.deepEqual(writeups.map((w) => w.slug), ['draft-piece', 'lead-piece', 'ready-piece']);
    const ready = writeups.find((w) => w.slug === 'ready-piece');
    assert.equal(ready?.published_at, '2026-05-29');
    assert.equal(ready?.featured_order, 2);
    assert.deepEqual(ready?.technologies, ['docker', 'python']);
    assert.equal(writeups.find((w) => w.slug === 'draft-piece')?.featured_order, null);
  });

  test('the featured order is published and featured, slotted 1..N', () => {
    assert.deepEqual(featuredOrder(loadWriteups(store)).map((e) => [e.slot, e.slug]), [[1, 'lead-piece'], [2, 'ready-piece']]);
  });

  test('filters select and sort', () => {
    assert.deepEqual(listWriteups(store, 'draft').writeups.map((w) => w.slug), ['draft-piece']);
    assert.deepEqual(listWriteups(store, 'featured').order.map((e) => e.slug), ['lead-piece', 'ready-piece']);
    assert.throws(() => listWriteups(store, 'bogus' as never), (error) => error instanceof WriteupError && error.code === 'invalid');
  });

  test('catalog and tag usage', () => {
    const catalog = technologyCatalog(store);
    assert.equal(catalog.totalSlugs, 3);
    assert.equal(catalog.featuredCount, 2);
    const usage = tagUsage(store, 'docker');
    assert.equal(usage.totalMatches, 3);
    assert.equal(usage.publishedMatches, 2);
    assert.throws(() => tagUsage(store, ' '), WriteupError);
  });

  test('prepare reports the gate and the featured position', async () => {
    const ready = await prepare(store, 'ready-piece', { includeTagUsage: true });
    assert.equal(ready.featuredSet.position, 2);
    assert.deepEqual(ready.tagUsage?.docker, { totalWriteups: 3, publishedWriteups: 2 });
    const draft = await prepare(store, 'draft-piece');
    assert.equal(draft.ok, false);
    assert.ok(draft.validation.issues.length > 0);
    await assert.rejects(prepare(store, 'nope'), (error) => error instanceof WriteupError && error.code === 'not_found');
  });
});

describe('frontmatter writes', () => {
  test('touch last_reviewed and flip published', () => {
    const result = updateFrontmatter(store, 'draft-piece', { published: true }, { touchLastReviewed: true, today: '2026-10-03' });
    assert.deepEqual(result.changedFields, ['last_reviewed', 'published']);
    assert.match(read('draft-piece'), /^published: true$/m);
    assert.match(read('draft-piece'), /^last_reviewed: 2026-10-03$/m);
    assert.equal(result.receipt?.operation, 'writeup.update');
  });

  test('a hand-written nonstandard bool is rewritten even though it reads as true', () => {
    fs.writeFileSync(file('draft-piece'), DRAFT.replace('published: false', 'published: yes'));
    const result = updateFrontmatter(store, 'draft-piece', { published: true });
    assert.equal(result.noOp, false);
    assert.deepEqual(result.changedFields, ['published']);
  });

  test('an unchanged value writes nothing', () => {
    const before = read('ready-piece');
    assert.equal(updateFrontmatter(store, 'ready-piece', { published: true }).noOp, true);
    assert.equal(read('ready-piece'), before);
  });

  test('only the changed line differs', () => {
    const before = read('draft-piece').split('\n');
    updateFrontmatter(store, 'draft-piece', { cover_image: './images/new.png' });
    const after = read('draft-piece').split('\n');
    assert.equal(after.length, before.length);
    const diff = after.filter((line, index) => line !== before[index]);
    assert.deepEqual(diff, ['cover_image: ./images/new.png']);
  });

  test('special characters are quoted and parse back', () => {
    const tricky = 'Notes on [arrays], colons: and commas';
    updateFrontmatter(store, 'draft-piece', { description: tricky });
    assert.ok(read('draft-piece').includes(`description: "${tricky}"`));
    assert.equal(loadWriteups(store).find((w) => w.slug === 'draft-piece')?.description, tricky);
  });

  test('fields outside the contract\'s editable set are refused', () => {
    assert.throws(() => updateFrontmatter(store, 'draft-piece', { featured_order: 4 }), (error) => error instanceof WriteupError && error.code === 'invalid');
  });
});

describe('links', () => {
  test('replace exactly one link and drop its title', () => {
    updateLink(store, 'ready-piece', 'the docs', 'https://example.com/old', 'https://example.com/new');
    assert.ok(read('ready-piece').includes('[the docs](https://example.com/new)'));
  });

  test('refuse zero matches and non-http targets', () => {
    assert.throws(() => updateLink(store, 'ready-piece', 'missing', 'https://example.com/old', 'https://example.com/new'), WriteupError);
    assert.throws(() => updateLink(store, 'ready-piece', 'the docs', 'https://example.com/old', 'ftp://x'), WriteupError);
  });
});

describe('featured order and plans', () => {
  test('insert an unfeatured writeup and shift the rest', () => {
    const result = reorderFeatured(store, 'draft-piece', 1);
    assert.deepEqual(result.featuredOrderAfter, ['draft-piece', 'lead-piece', 'ready-piece']);
    assert.match(read('draft-piece'), /^featured_order: 1$/m);
    assert.match(read('ready-piece'), /^featured_order: 3$/m);
  });

  test('move and unfeature', () => {
    assert.deepEqual(reorderFeatured(store, 'ready-piece', 1).featuredOrderAfter, ['ready-piece', 'lead-piece']);
    reorderFeatured(store, 'lead-piece', 0);
    assert.match(read('lead-piece'), /^featured: false$/m);
    assert.match(read('lead-piece'), /^featured_order:$/m);
    assert.match(read('ready-piece'), /^featured_order: 1$/m);
  });

  test('out-of-range positions are refused', () => {
    assert.throws(() => reorderFeatured(store, 'draft-piece', 9), (error) => error instanceof WriteupError && error.code === 'invalid');
  });

  test('a plan sets fields and the complete order together', () => {
    const result = applyPlan(store, {
      updates: [{ slug: 'draft-piece', title: 'Renamed' }],
      featured_order: ['ready-piece', 'draft-piece'],
    });
    assert.deepEqual(result.changedWriteups, ['draft-piece', 'lead-piece', 'ready-piece']);
    assert.match(read('draft-piece'), /^title: Renamed$/m);
    assert.match(read('lead-piece'), /^featured: false$/m);
    assert.ok(result.receipt?.idempotency_key);
  });

  test('a plan built on a stale snapshot is refused', () => {
    const { sourceFingerprint } = snapshot(store);
    updateFrontmatter(store, 'lead-piece', { title: 'Changed underneath' });
    assert.throws(
      () => applyPlan(store, { updates: [{ slug: 'ready-piece', title: 'X' }], source_fingerprint: sourceFingerprint }),
      (error) => error instanceof WriteupError && error.code === 'stale_plan',
    );
  });

  test('duplicate and unknown slugs are refused', () => {
    assert.throws(() => applyPlan(store, { featured_order: ['lead-piece', 'lead-piece'] }), WriteupError);
    assert.throws(() => applyPlan(store, { updates: [{ slug: 'nope', title: 'X' }] }), WriteupError);
  });

  test('a failed replace rolls back every file already swapped', () => {
    const originals = { lead: read('lead-piece'), ready: read('ready-piece') };
    let calls = 0;
    const rename = (from: string, to: string): void => {
      calls += 1;
      if (calls === 2) throw new Error('simulated replacement failure');
      fs.renameSync(from, to);
    };
    assert.throws(
      () => applyPlan(store, { updates: [{ slug: 'lead-piece', title: 'L' }, { slug: 'ready-piece', title: 'R' }] }, { rename }),
      (error) => error instanceof WriteupError && error.code === 'transaction_failed' && error.details.rolled_back === true,
    );
    assert.equal(read('lead-piece'), originals.lead);
    assert.equal(read('ready-piece'), originals.ready);
    assert.deepEqual(fs.readdirSync(path.join(store.writeupsDir, 'lead-piece')).filter((name) => name.startsWith('.')), []);
  });
});
