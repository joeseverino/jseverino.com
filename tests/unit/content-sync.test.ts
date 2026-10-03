// The content-sync modules: reference handling, the writer and prune, the
// document rows, the education join, and a whole sync against a temp vault.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

import {
  collectAssetRefs,
  collectReferences,
  mapLimit,
  referenceIssues,
  resolveAssetSource,
  rewriteAssetUrls,
} from '../../bin/content-sync/assets.ts';
import { createWriter } from '../../bin/content-sync/writer.ts';
import { orgRow, renderDocumentRows, roleRow, type Grammar } from '../../bin/content-sync/documents.ts';
import { buildEducation } from '../../bin/content-sync/education.ts';
import { checkContent, committedLayout, syncContent } from '../../bin/content-sync/sync.ts';
import { parseFrontmatter } from '../../src/lib/frontmatter.ts';
import { readJson } from '../../src/lib/json.ts';
import type { Manifest } from '../../src/lib/images.ts';
import { tempDir, write } from './helpers/fs.ts';
import { adoptLegacyImageCache } from '../../bin/lib/cache.ts';
import { permittedContentRoot } from '../../src/lib/content-root.ts';


describe('asset references', () => {
  const body = [
    '![Alt](./images/a.png "A title")',
    '![Same](<images/b c.png>)',
    '[Download](images/doc.pdf#page=2)',
    '[![thumb](./images/t.png)](images/full.png)',
    '[ref]: ./images/ref.png "Ref title"',
    '<img src="./images/raw.png" alt="">',
    '![External](https://example.com/images/x.png)',
    '[Anchor](#images/no)',
    '![Absolute](/assets/og/card.png)',
  ].join('\n');

  test('every relative destination is found once, titles and brackets aside', () => {
    assert.deepEqual([...collectAssetRefs(body)].sort(), [
      'images/a.png', 'images/b c.png', 'images/doc.pdf', 'images/full.png', 'images/raw.png', 'images/ref.png', 'images/t.png',
    ]);
  });

  test('rewrites exactly the collected destinations, keeping titles, fragments, and external URLs', () => {
    const rewritten = rewriteAssetUrls(body, '/assets/writeups/demo');
    assert.match(rewritten, /!\[Alt\]\(\/assets\/writeups\/demo\/images\/a\.png "A title"\)/);
    assert.match(rewritten, /!\[Same\]\(<\/assets\/writeups\/demo\/images\/b c\.png>\)/);
    assert.match(rewritten, /\(\/assets\/writeups\/demo\/images\/doc\.pdf#page=2\)/);
    assert.match(rewritten, /\[!\[thumb\]\(\/assets\/writeups\/demo\/images\/t\.png\)\]\(\/assets\/writeups\/demo\/images\/full\.png\)/);
    assert.match(rewritten, /\[ref\]: \/assets\/writeups\/demo\/images\/ref\.png "Ref title"/);
    assert.match(rewritten, /src="\/assets\/writeups\/demo\/images\/raw\.png"/);
    assert.match(rewritten, /https:\/\/example\.com\/images\/x\.png/);
    assert.match(rewritten, /\(\/assets\/og\/card\.png\)/);
  });

  test('alt text that repeats the destination is never the part rewritten', () => {
    assert.equal(
      rewriteAssetUrls('![./images/a.png](./images/a.png)', '/x'),
      '![./images/a.png](/x/images/a.png)',
    );
  });

  test('a reference escaping its folder is refused', () => {
    assert.throws(() => resolveAssetSource('/vault/w/demo', 'images/../../secret.md'), /outside its source folder/);
    assert.equal(resolveAssetSource('/vault/w/demo', 'images/a.png'), '/vault/w/demo/images/a.png');
  });

  test('reference issues: missing images, refs outside images/, wikilinks, the cover', async () => {
    const dir = tempDir('refs-');
    write(path.join(dir, 'images/here.png'), 'x');
    const issues = await referenceIssues(
      '![ok](images/here.png)\n![gone](images/gone.png)\n[notes](./notes.md)\n![[embed.png]]\n',
      dir,
      { cover: './images/cover.png' },
    );
    assert.deepEqual(issues, [
      'missing image: images/gone.png',
      'relative reference outside images/ will not resolve on the site: ./notes.md',
      'missing image: images/cover.png',
      'Obsidian wikilink does not render on the site: ![[embed.png]]',
    ]);
    assert.deepEqual(collectReferences('[a](images/x.png) [b](images/x.png)').length, 1);
  });

  test('mapLimit never runs more than the limit at once', async () => {
    let running = 0;
    let peak = 0;
    const results = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n: number) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return n * 2;
    });
    assert.equal(peak, 2);
    assert.deepEqual(results, [2, 4, 6, 8, 10, 12]);
  });
});

describe('writer and prune', () => {
  test('prune removes what the run did not write, then empty folders; the report names both', async () => {
    const root = tempDir('writer-');
    write(path.join(root, 'content/writeups/old/index.md'), 'stale');
    write(path.join(root, 'content/writeups/kept/index.md'), 'old');
    const writer = createWriter({ root });
    await writer.write(path.join(root, 'content/writeups/kept/index.md'), 'new');
    await writer.prune([path.join(root, 'content/writeups')]);
    assert.deepEqual(writer.report(), {
      written: ['content/writeups/kept/index.md'],
      removed: ['content/writeups/old/index.md'],
    });
    assert.equal(fs.existsSync(path.join(root, 'content/writeups/old')), false);
    assert.equal(fs.readFileSync(path.join(root, 'content/writeups/kept/index.md'), 'utf8'), 'new');
  });
});

// A small stand-in for resume-engine's grammar: `### Org | Location` and
// `**Title** | dates` lines.
const grammar: Grammar = {
  linesForSite: (lines) => lines,
  matchOrg: (line) => {
    const [, name, location] = line.match(/^### (.+) \| (.+)$/) ?? [];
    return name && location ? { name, location } : null;
  },
  matchRole: (line) => {
    const [, title, dates] = line.match(/^\*\*(.+)\*\* \| (.+)$/) ?? [];
    return title && dates ? { title, dates } : null;
  },
  matchCert: () => null,
  matchProjectMeta: () => null,
  orgRoleDates: (lines, index) => {
    const dates: string[] = [];
    for (const line of lines.slice(index + 1)) {
      if (line.startsWith('### ')) break;
      const [, range] = line.match(/^\*\*.+\*\* \| (.+)$/) ?? [];
      if (range) dates.push(range);
    }
    return dates;
  },
  tenureSpan: (dates) => `${dates.at(-1)} – ${dates[0]}`,
};

describe('document rows', () => {
  test('org headings carry a tenure for multi-role orgs and the link they are given', () => {
    const html = renderDocumentRows(
      grammar,
      '### Acme | Remote\n**Lead** | 2024\n**Engineer** | 2022\n### School | City\n**BS** | 2020',
      new Map([['School', '/education/school/']]),
    );
    assert.equal(html, [
      orgRow({ name: 'Acme', location: 'Remote' }, { tenure: '2022 – 2024' }),
      roleRow({ title: 'Lead', dates: '2024' }),
      roleRow({ title: 'Engineer', dates: '2022' }),
      '<h3 class="resume-org"><span><a href="/education/school/">School</a></span><span class="resume-loc">City</span></h3>',
      roleRow({ title: 'BS', dates: '2020' }),
    ].join('\n'));
  });
});

describe('education', () => {
  const resume = { content: '## Experience\n### Acme | Remote\n## Education\n### School | City\n**BS Computing** | 2020\n### Other | Town' };
  const dataset = {
    institutions: [{
      institution: 'School',
      slug: 'school',
      description: 'A school.',
      courses: [
        { code: 'CS101', title: 'Intro', term: 'Fall 2024', status: 'completed', site_bullets: '- Learned things' },
        { code: 'CS201', title: 'Next', term: 'Spring 2025', status: 'active', site_bullets: '- Learning' },
        { code: 'CS301', title: 'Later', term: 'Fall 2025', status: 'planned', site_bullets: '- Soon' },
      ],
    }],
  };
  const shell = { data: { title: 'Education', published: true }, content: 'Intro prose.' };
  const projectPage = (data: Record<string, unknown>) => data;

  test('joins vault institutions to resume orgs and returns the links explicitly', () => {
    const { pages, links } = buildEducation({ grammar, shell, resume, dataset, projectPage });
    assert.deepEqual([...links], [['School', '/education/school/']]);
    assert.deepEqual(pages.map((page) => page.page), ['education/school.md', 'education.md']);
    const [detailPage, indexPage] = pages;
    assert.ok(detailPage && indexPage);
    const index = parseFrontmatter(indexPage.content);
    assert.equal(index.content.trim(), [
      'Intro prose.',
      orgRow({ name: 'School', location: 'City' }, { href: '/education/school/' }),
      roleRow({ title: 'BS Computing', dates: '2020' }),
      '- 1 course completed · 1 in progress',
    ].join('\n\n'));
    const detail = parseFrontmatter(detailPage.content);
    assert.equal(detail.data.path, '/education/school/');
    assert.match(detail.content, /CS 101 — Intro \(Fall 2024\)/);
    assert.doesNotMatch(detail.content, /CS 301/);
  });

  test('an institution missing from the resume canonical fails', () => {
    const orphan = { institutions: [...dataset.institutions, { institution: 'Nowhere', slug: 'n', description: '', courses: [] }] };
    assert.throws(() => buildEducation({ grammar, shell, resume, dataset: orphan, projectPage }), /Nowhere/);
  });
});

async function fixtureVault() {
  const vault = tempDir('vault-');
  const png = await sharp({ create: { width: 600, height: 300, channels: 3, background: '#123456' } }).png().toBuffer();
  write(path.join(vault, '06 Pages/_technology-groups.md'), '## Tools\n\n| Slug | Label | Featured |\n| --- | --- | --- |\n| astro | Astro | yes |\n');
  write(path.join(vault, '06 Pages/about/index.md'), '---\ntitle: About\npublished: true\n---\n![Me](./images/me.png)\n');
  write(path.join(vault, '06 Pages/about/images/me.png'), png);
  write(path.join(vault, '05 Writeups/live/index.md'), [
    '---', 'title: Live', 'description: A live one.', 'published: true', 'published_at: 2026-01-02',
    'cover_image: ./images/cover.png', 'technologies:', '  - astro', 'related_projects:', '  - private', '---',
    '# Live', '', 'Body with ![Diagram](images/diagram.png "Diagram").', '',
  ].join('\n'));
  write(path.join(vault, '05 Writeups/live/images/cover.png'), png);
  write(path.join(vault, '05 Writeups/live/images/diagram.png'), png);
  // An unpublished resume canonical: the resume page is skipped.
  write(path.join(vault, 'life/Career/resume.md'), '---\npublished: false\n---\n');
  write(path.join(vault, '05 Writeups/draft/index.md'), '---\ntitle: CHANGEME\npublished: false\ntechnologies:\n  - nope\n---\n![x](images/missing.png)\n');
  return vault;
}

describe('syncContent and checkContent against a temp vault', () => {
  test('writes the public snapshot, declares every file, and prunes the rest', async () => {
    const vault = await fixtureVault();
    const root = tempDir('site-');
    write(path.join(root, 'src/content/writeups/gone/index.md'), '---\ntitle: Gone\n---\n');
    write(path.join(root, 'public/assets/writeups/gone/images/old.png'), 'x');
    const result = await syncContent({
      layout: committedLayout(root),
      vaultRoot: vault,
      lifeVaultRoot: path.join(vault, 'life'),
      resumeEngineRoot: path.join(vault, 'no-resume-engine'),
      cacheDir: path.join(root, '.cache/images'),
      educationSource: { load: async () => ({ institutions: [] }) },
      date: '2026-07-26',
    });

    assert.deepEqual(result.removed, ['public/assets/writeups/gone/images/old.png', 'src/content/writeups/gone/index.md']);
    assert.ok(result.written.includes('src/lib/image-manifest.json'));
    assert.ok(result.written.includes('src/content/technology-groups.md'));
    assert.ok(result.written.includes('public/assets/writeups/live/images/diagram-512.avif'));
    assert.ok(!result.written.some((file) => file.includes('draft')));
    for (const file of result.written) assert.ok(fs.existsSync(path.join(root, file)), file);

    const live = parseFrontmatter(fs.readFileSync(path.join(root, 'src/content/writeups/live/index.md'), 'utf8'));
    assert.equal(live.data.cover_image, '/assets/writeups/live/images/cover.png');
    assert.equal(live.data.related_projects, undefined);
    assert.match(live.content, /\(\/assets\/writeups\/live\/images\/diagram\.png "Diagram"\)/);

    const manifest = readJson<Manifest>(path.join(root, 'src/lib/image-manifest.json'));
    assert.deepEqual(Object.keys(manifest), [
      '/assets/pages/about/images/me.png',
      '/assets/writeups/live/images/cover.png',
      '/assets/writeups/live/images/diagram.png',
    ]);
    assert.equal(manifest['/assets/writeups/live/images/cover.png']?.w, 600);
    const cached = fs.readdirSync(path.join(root, '.cache/images'), { recursive: true }).map(String);
    assert.ok(cached.length > 0 && !cached.some((file) => file.endsWith('.tmp')), 'cache writes land by rename');
  });

  test('a drafts sync previews a draft with a missing image as a warning, not a failure', async () => {
    const vault = await fixtureVault();
    const root = tempDir('overlay-');
    // Drafts include the unpublished resume canonical, which renders through the grammar.
    write(path.join(vault, 'resume-engine/lib/grammar.mjs'), [
      'export const linesForSite = (lines) => lines;',
      'export const matchOrg = () => null;',
      'export const matchRole = () => null;',
      'export const matchCert = () => null;',
      'export const matchProjectMeta = () => null;',
      'export const orgRoleDates = () => [];',
      'export const tenureSpan = () => "";',
    ].join('\n'));
    const result = await syncContent({
      layout: committedLayout(root),
      vaultRoot: vault,
      lifeVaultRoot: path.join(vault, 'life'),
      resumeEngineRoot: path.join(vault, 'resume-engine'),
      cacheDir: path.join(root, '.cache/images'),
      educationSource: { load: async () => ({ institutions: [] }) },
      includeDrafts: true,
    });
    assert.deepEqual(result.warnings, ['draft writeups/draft: missing image images/missing.png']);
    assert.ok(result.written.includes('src/content/writeups/draft/index.md'));
  });

  test('a published relative link outside images/ stops the sync with the message validate reports', async () => {
    const vault = await fixtureVault();
    write(path.join(vault, '05 Writeups/live/index.md'), [
      '---', 'title: Live', 'description: A live one.', 'published: true', 'published_at: 2026-01-02',
      'technologies:', '  - astro', '---', '', 'See [the notes](notes.md).', '',
    ].join('\n'));
    const root = tempDir('site-');
    await assert.rejects(syncContent({
      layout: committedLayout(root),
      vaultRoot: vault,
      lifeVaultRoot: path.join(vault, 'life'),
      resumeEngineRoot: path.join(vault, 'no-resume-engine'),
      cacheDir: path.join(root, '.cache/images'),
      educationSource: { load: async () => ({ institutions: [] }) },
      date: '2026-07-26',
    }), /writeups\/live: relative reference outside images\/ will not resolve on the site: notes\.md/);
    const checked = await checkContent({ vaultRoot: vault });
    const live = checked.documents.find((doc) => doc.slug === 'live');
    assert.ok(live?.issues.includes('relative reference outside images/ will not resolve on the site: notes.md'), JSON.stringify(live?.issues));
  });

  test('checkContent reports per document without writing; --draft adds drafts', async () => {
    const vault = await fixtureVault();
    const published = await checkContent({ vaultRoot: vault });
    assert.equal(published.ok, true);
    assert.deepEqual(published.documents.map((doc) => `${doc.collection}/${doc.slug}`), ['writeups/live', 'pages/about']);

    const drafts = await checkContent({ vaultRoot: vault, draft: true });
    const draft = drafts.documents.find((doc) => doc.slug === 'draft');
    assert.equal(drafts.ok, false);
    assert.deepEqual(draft?.issues, [
      'title still holds the template placeholder',
      'technology slug not in the catalog: nope',
      'missing image: images/missing.png',
    ]);

    const one = await checkContent({ vaultRoot: vault, slug: 'draft' });
    assert.ok(one.documents[0]?.issues.includes('published is not true (validate a draft with --draft)'));
    const missing = await checkContent({ vaultRoot: vault, slug: 'nope' });
    assert.match(missing.documents[0]?.issues[0] ?? '', /writeup not found/);
  });
});

describe('image cache location', () => {
  test('the earlier node_modules cache moves into place once, and never over an existing cache', () => {
    const root = tempDir('cache-');
    const legacy = path.join(root, 'node_modules/.cache/jseverino-img');
    const target = path.join(root, '.cache/images');
    write(path.join(legacy, 'sharp-x/a.avif'), 'a');
    assert.equal(adoptLegacyImageCache(target, legacy), true);
    assert.equal(fs.readFileSync(path.join(target, 'sharp-x/a.avif'), 'utf8'), 'a');
    assert.equal(fs.existsSync(legacy), false);
    write(path.join(legacy, 'sharp-x/b.avif'), 'b');
    assert.equal(adoptLegacyImageCache(target, legacy), false);
    assert.equal(fs.existsSync(path.join(target, 'sharp-x/b.avif')), false);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('content root overrides', () => {
  test('a build reads only fixtures or the drafts overlay besides src/content', () => {
    const root = '/repo';
    assert.equal(permittedContentRoot('tests/fixtures/content', root), true);
    assert.equal(permittedContentRoot('/repo/.cache/drafts', root), true);
    assert.equal(permittedContentRoot('.cache/drafts', root), true);
    assert.equal(permittedContentRoot('tests/fixtures', root), false);
    assert.equal(permittedContentRoot('tests/fixtures/../../elsewhere', root), false);
    assert.equal(permittedContentRoot('/tmp/content', root), false);
    assert.equal(permittedContentRoot('src/content-old', root), false);
  });
});
