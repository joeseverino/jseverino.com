import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

import {
  collectAssetRefs,
  collectReferences,
  createMasterEncoder,
  MASTER_WIDTH,
  mapLimit,
  referenceIssues,
  resolveAssetSource,
} from '../../bin/content-sync/assets.ts';
import { stripArticleChrome } from '../../src/lib/writeup-body.ts';
import { createWriter } from '../../bin/content-sync/writer.ts';
import { orgRow, renderDocumentRows, roleRow, type Grammar } from '../../bin/content-sync/documents.ts';
import { buildEducation } from '../../bin/content-sync/education.ts';
import { checkContent, committedLayout, syncContent } from '../../bin/content-sync/sync.ts';
import { parseFrontmatter } from '../../src/lib/frontmatter.ts';
import { scratchDirs, write } from './helpers/fs.ts';
import { permittedContentRoot } from '../../src/lib/content-root.ts';

const scratch = scratchDirs('content-sync-');
after(scratch.cleanup);


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

  test('a writeup body drops the H1, the lede blockquote, and the leading image its page renders from frontmatter', () => {
    assert.equal(stripArticleChrome('# Title\n\n> The lede.\n\n![Cover](./images/cover.png)\n\nBody.\n'), 'Body.\n');
    assert.equal(stripArticleChrome('Body first.\n\n# Later heading\n'), 'Body first.\n\n# Later heading\n');
  });

  test('a reference escaping its folder is refused', () => {
    assert.throws(() => resolveAssetSource('/vault/w/demo', 'images/../../secret.md'), /outside its source folder/);
    assert.equal(resolveAssetSource('/vault/w/demo', 'images/a.png'), '/vault/w/demo/images/a.png');
  });

  test('reference issues: missing images, refs outside images/, wikilinks, the cover', async () => {
    const dir = scratch.make();
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
    const root = scratch.make();
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
    assert.deepEqual(pages.map((page) => page.page), ['education/school/index.mdx', 'education/index.mdx']);
    const [detailPage, indexPage] = pages;
    assert.ok(detailPage && indexPage);
    const index = parseFrontmatter(indexPage.content);
    assert.equal(index.content.trim(), [
      'Intro prose.',
      '<h2 class="visually-hidden">Institutions</h2>',
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
  const vault = scratch.make();
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
  write(path.join(vault, '05 Writeups/draft/index.md'), '---\ntitle: CHANGEME\npublished: false\ntechnologies:\n  - nope\n---\nWork in progress.\n\n![x](images/missing.png)\n');
  return vault;
}

describe('syncContent and checkContent against a temp vault', () => {
  test('writes the public snapshot, declares every file, and prunes the rest', async () => {
    const vault = await fixtureVault();
    const root = scratch.make();
    write(path.join(root, 'src/content/writeups/gone/index.mdx'), '---\ntitle: Gone\n---\n');
    const result = await syncContent({
      layout: committedLayout(root),
      vaultRoot: vault,
      lifeVaultRoot: path.join(vault, 'life'),
      resumeEngineRoot: path.join(vault, 'no-resume-engine'),
      cacheDir: path.join(root, '.cache/images'),
      educationSource: { load: async () => ({ institutions: [] }) },
      date: '2026-07-26',
    });

    assert.deepEqual(result.removed, ['src/content/writeups/gone/index.mdx']);
    assert.ok(result.written.includes('src/content/technology-groups.md'));
    assert.ok(result.written.includes('src/content/pages/about/index.mdx'));
    assert.ok(result.written.includes('src/content/pages/about/images/me.png'));
    assert.ok(result.written.includes('src/content/writeups/live/images/diagram.png'));
    assert.ok(!result.written.some((file) => file.includes('draft')));
    for (const file of result.written) assert.ok(fs.existsSync(path.join(root, file)), file);

    const live = parseFrontmatter(fs.readFileSync(path.join(root, 'src/content/writeups/live/index.mdx'), 'utf8'));
    assert.equal(live.data.cover_image, './images/cover.png');
    assert.equal(live.data.related_projects, undefined);
    assert.equal(live.content, 'Body with ![Diagram](images/diagram.png "Diagram").\n');
    const cached = fs.readdirSync(path.join(root, '.cache/images'), { recursive: true }).map(String);
    assert.ok(cached.length > 0 && !cached.some((file) => file.endsWith('.tmp')), 'cache writes land by rename');
  });

  test('a drafts sync previews a draft with a missing image as a warning, not a failure', async () => {
    const vault = await fixtureVault();
    const root = scratch.make();
    write(path.join(vault, 'resume-engine/lib/grammar.ts'), [
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
    assert.ok(result.written.includes('src/content/writeups/draft/index.mdx'));
  });

  test('a published relative link outside images/ stops the sync with the message validate reports', async () => {
    const vault = await fixtureVault();
    write(path.join(vault, '05 Writeups/live/index.md'), [
      '---', 'title: Live', 'description: A live one.', 'published: true', 'published_at: 2026-01-02',
      'technologies:', '  - astro', '---', '', 'See [the notes](notes.md).', '',
    ].join('\n'));
    const root = scratch.make();
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

describe('image masters', () => {
  test('a master is at most MASTER_WIDTH wide and carries no metadata', async () => {
    const dir = scratch.make();
    const source = path.join(dir, 'wide.jpg');
    write(source, await sharp({ create: { width: 2400, height: 1200, channels: 3, background: '#336699' } })
      .withExif({ IFD0: { Make: 'Camera', Software: 'Tool' } })
      .jpeg()
      .toBuffer());
    const master = createMasterEncoder(path.join(dir, 'cache'));
    const meta = await sharp(await master(source)).metadata();
    assert.equal(meta.width, MASTER_WIDTH);
    assert.equal(meta.height, MASTER_WIDTH / 2);
    assert.equal(meta.exif, undefined);
    assert.equal(meta.icc, undefined);
    assert.deepEqual(await master(source), await master(source), 'a second encode is the cached bytes');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('MDX compile issues', () => {
  test('checkContent reports what the build would refuse, with its line', async () => {
    const vault = await fixtureVault();
    write(path.join(vault, '05 Writeups/live/index.md'), [
      '---', 'title: Live', 'description: A live one.', 'published: true', 'published_at: 2026-01-02',
      'cover_image: ./images/cover.png', 'technologies:', '  - astro', '---', '', 'Costs {price} today.', '',
    ].join('\n'));
    const checked = await checkContent({ vaultRoot: vault });
    const live = checked.documents.find((doc) => doc.slug === 'live');
    assert.ok(live?.issues.some((issue) => /\{price\} is an expression/.test(issue)), JSON.stringify(live?.issues));
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
