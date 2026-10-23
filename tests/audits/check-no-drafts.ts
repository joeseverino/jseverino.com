// The committed snapshot holds published content only: a draft synced into
// src/content would deploy. Drafts preview from the gitignored overlay.
import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from '../../src/lib/frontmatter.ts';
import { siteRoot } from '../../src/lib/site-root.ts';
import { DOCUMENT_FILE } from '../../src/lib/snapshot.ts';
import { abort, finish } from './lib.ts';

const contentDir = path.join(siteRoot, 'src/content');
const documents = fs
  .readdirSync(contentDir, { recursive: true, encoding: 'utf8' })
  .filter((file) => path.basename(file) === DOCUMENT_FILE)
  .map((file) => path.join(contentDir, file));
if (documents.length === 0) abort('check-no-drafts', `no ${DOCUMENT_FILE} under ${path.relative(siteRoot, contentDir)}; run mise run sync:content`);
const drafts = documents.filter((file) => parseFrontmatter(fs.readFileSync(file, 'utf8')).data.published === false);

finish(
  drafts.map((file) => `published: false in ${path.relative(siteRoot, file)}`),
  `${documents.length} committed documents, none a draft`,
  {
    bullet: '- ',
    fix: 'fix: run `mise run sync:content` (drafts belong in the overlay `site dev --drafts` writes)',
  },
);
