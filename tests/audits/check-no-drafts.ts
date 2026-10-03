#!/usr/bin/env node
// The committed snapshot holds published content only: a draft synced into
// src/content would deploy. Drafts preview from the gitignored overlay.
import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from '../../src/lib/frontmatter.ts';
import { siteRoot } from '../../src/lib/site-root.ts';
import { walkFiles } from '../../src/lib/walk.ts';
import { finish } from './lib.ts';

const contentDir = path.join(siteRoot, 'src/content');
const documents = walkFiles(contentDir, { filter: (file) => file.endsWith('.md') });
const drafts = documents.filter((file) => parseFrontmatter(fs.readFileSync(file, 'utf8')).data.published === false);

finish(drafts.map((file) => `published: false in ${path.relative(siteRoot, file)}`), `${documents.length} committed documents, none a draft`, {
  bullet: '- ',
  fix: 'run: npm run sync:content (drafts belong in the overlay `site dev --drafts` writes)',
});
