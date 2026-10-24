import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createPublicProjection, reviewedDate } from '../../bin/content-sync/public-projection.ts';
import { updateFrontmatter, WriteupError } from '../../bin/lib/writeups/store.ts';
import { FIELDS } from '../../bin/site/manage-model.ts';
import { collectionFields, contentContractFingerprint, frontmatterIssues, projectFrontmatter } from '../../src/lib/content-contract.ts';
import { stripRepeatedDescription } from '../../src/lib/writeup-body.ts';

describe('canonical content contract', () => {
  test('projects only public fields and applies contract defaults', () => {
    assert.deepEqual(
      projectFrontmatter('writeups', {
        doc_id: 'private-id',
        title: 'Contract-driven content',
        technologies: ['astro'],
        related_projects: ['private-relation'],
      }),
      {
        title: 'Contract-driven content',
        published: false,
        technologies: ['astro'],
        featured: false,
      },
    );
  });

  test('fingerprint is a stable sha256 identifier', () => {
    assert.match(contentContractFingerprint(), /^[a-f0-9]{64}$/);
    assert.equal(contentContractFingerprint(), contentContractFingerprint());
  });

  test('writeup projection keeps the cover relative to the document and dates the review from the committed snapshot', () => {
    const previous = { data: { last_reviewed: new Date('2026-05-01') }, content: 'old body\n' };
    const projection = createPublicProjection({ today: '2026-07-26', previousWriteup: () => previous });
    const result = projection.writeup(
      { title: 'Article', published: true, cover_image: 'images/cover.png' },
      { slug: 'article', body: 'new body\n' },
    ) as Record<string, unknown>;

    assert.equal(result.last_reviewed, '2026-07-26');
    assert.equal(result.cover_image, './images/cover.png');
  });

  test('an unchanged body keeps the later review date, so a re-sync is idempotent', () => {
    const committed = new Date('2026-06-01');
    const previous = { data: { last_reviewed: committed }, content: 'body\n' };
    assert.equal(reviewedDate({ last_reviewed: new Date('2026-05-01') }, previous, 'body\n', '2026-07-26'), committed);
    const vault = new Date('2026-06-15');
    assert.equal(reviewedDate({ last_reviewed: vault }, previous, 'body\n', '2026-07-26'), vault);
    assert.equal(reviewedDate({ published_at: '2026-04-01' }, undefined, 'body\n', '2026-07-26'), '2026-04-01');
    assert.equal(reviewedDate({}, undefined, 'body\n', '2026-07-26'), '2026-07-26');
  });

  test('frontmatter issues name missing required fields and wrong types', () => {
    assert.deepEqual(frontmatterIssues('writeups', { title: 'T', published: true, published_at: new Date('2026-01-01'), technologies: ['a'] }), []);
    assert.deepEqual(frontmatterIssues('writeups', { published: 'yes', technologies: 'astro', published_at: 'soon' }), [
      'missing required field: title',
      'published must be boolean',
      'published_at must be date',
      'technologies must be string[]',
    ]);
  });

  test('removes a repeated public description without changing the body', () => {
    const markdown = '# Heading\n\n> A concise description.\n\nBody stays here.\n';
    assert.equal(stripRepeatedDescription(markdown, 'A concise description.'), '# Heading\n\nBody stays here.\n');
  });
});

// Every consumer reads its field list from contracts/content.v1.json, so a field
// added there reaches the public projection, the store, and `site manage` at once.
describe('consumers of the writeup contract', () => {
  const fields = Object.entries(collectionFields('writeups'));
  const names = (keep: (spec: (typeof fields)[number][1]) => boolean): string[] => fields.filter(([, spec]) => keep(spec)).map(([name]) => name);
  const filled = Object.fromEntries(fields.map(([name]) => [name, `${name} value`]));

  test('the public projection emits exactly the public fields', () => {
    const projection = createPublicProjection({ today: '2026-07-26' });
    const publicFields = names((spec) => spec.public === true);
    assert.deepEqual(Object.keys(projectFrontmatter('writeups', filled)), publicFields);
    assert.deepEqual(Object.keys(projection.writeup(filled, { slug: 'article', body: '' })), publicFields);
  });

  test('the writeup store accepts exactly the editable fields', () => {
    const missingVault = { vaultRoot: '/nonexistent', writeupsDir: '/nonexistent/writeups', catalogPath: '/nonexistent/catalog.md' };
    const refused = (name: string): boolean => {
      try {
        updateFrontmatter(missingVault, 'article', { [name]: filled[name] });
      } catch (error) {
        return error instanceof WriteupError && error.code === 'invalid';
      }
      return false;
    };
    assert.deepEqual(
      fields.map(([name]) => name).filter((name) => !refused(name)),
      names((spec) => spec.editable === true),
    );
  });

  test('site manage lists every field but the id and the ones it toggles, editable as the contract says', () => {
    const listed = fields.filter(([name, spec]) => name !== 'doc_id' && spec.ownership !== 'publish-state' && spec.ownership !== 'featured-order');
    assert.deepEqual(
      FIELDS.map(({ label, editable }) => [label, editable]),
      listed.map(([name, spec]) => [name, spec.editable === true]),
    );
  });
});
