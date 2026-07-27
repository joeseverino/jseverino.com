import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  contentContractFingerprint,
  projectFrontmatter,
} from '../../src/lib/content-contract.mjs';
import {
  createPublicProjection,
  stripRepeatedDescription,
} from '../../bin/content-sync/public-projection.mjs';

describe('canonical content contract', () => {
  test('projects only public fields and applies contract defaults', () => {
    assert.deepEqual(projectFrontmatter('writeups', {
      doc_id: 'private-id',
      title: 'Contract-driven content',
      technologies: ['astro'],
      related_projects: ['private-relation'],
    }), {
      title: 'Contract-driven content',
      published: false,
      technologies: ['astro'],
      featured: false,
    });
  });

  test('fingerprint is a stable sha256 identifier', () => {
    assert.match(contentContractFingerprint(), /^[a-f0-9]{64}$/);
    assert.equal(contentContractFingerprint(), contentContractFingerprint());
  });

  test('writeup projection owns review-date and hash derivation', () => {
    const manifest = { article: 'old-hash' };
    const projection = createPublicProjection({ syncManifest: manifest, today: '2026-07-26' });
    const result = projection.writeup({ title: 'Article', published: true }, 'new-hash', 'article');

    assert.equal((result as Record<string, unknown>).last_reviewed, '2026-07-26');
    assert.equal(manifest.article, 'new-hash');
  });

  test('removes a repeated public description without changing the body', () => {
    const markdown = '# Heading\n\n> A concise description.\n\nBody stays here.\n';
    assert.equal(
      stripRepeatedDescription(markdown, 'A concise description.'),
      '# Heading\n\nBody stays here.\n',
    );
  });
});
