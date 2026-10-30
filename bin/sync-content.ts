#!/usr/bin/env node

// Sync the public pages and writeups from the vault into the repo snapshot:
// src/content/<collection>/<slug>/index.mdx with its image masters beside it.
//
//   node bin/sync-content.ts                  # write the committed snapshot
//   node bin/sync-content.ts --report <file>  # also write the files it owns as JSON
//   node bin/sync-content.ts --drafts         # drafts included, into the gitignored overlay
//   node bin/sync-content.ts --check [--slug <s>] [--draft] [--json]
//                                              # resolve references and the contract; write nothing

import path from 'node:path';
import { writeJson } from '../src/lib/json.ts';
import { siteRoot } from '../src/lib/site-root.ts';
import { createEducationSource } from './content-sync/source-adapters.ts';
import { checkContent, committedLayout, overlayLayout, syncContent } from './content-sync/sync.ts';
import type { SyncReport } from './content-sync/writer.ts';
import { cli, exitWith, flag } from './lib/args.ts';
import { cacheDir, draftsOverlay } from './lib/cache.ts';
import { educationExportFile, existingDir, lifeVaultRoot, resumeEngineRoot, vaultRoot } from './lib/local-paths.ts';

const usage = `usage: node bin/sync-content.ts [--drafts] [--report <file>]
       node bin/sync-content.ts --check [--slug <slug>] [--draft] [--json]`;
const { values } = cli({
  usage,
  options: {
    drafts: flag,
    report: { type: 'string' },
    check: flag,
    slug: { type: 'string' },
    draft: flag,
    json: flag,
  },
});

// --check: resolve every reference and the contract, write nothing.
async function check(): Promise<number> {
  const result = await checkContent({ vaultRoot: existingDir('vault', vaultRoot(), 'VAULT_DIR'), slug: values.slug, draft: values.draft });
  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
    return result.ok ? 0 : 1;
  }
  const failing = result.documents.filter((doc) => doc.issues.length > 0);
  for (const doc of failing) {
    console.log(`${doc.collection}/${doc.slug}:`);
    for (const issue of doc.issues) console.log(`  - ${issue}`);
  }
  console.log(
    failing.length === 0
      ? `ok       ${result.documents.length} documents resolve`
      : `failed: ${failing.length} of ${result.documents.length} documents have issues`,
  );
  return result.ok ? 0 : 1;
}

async function sync(): Promise<number> {
  const overlay = draftsOverlay();
  const layout = values.drafts ? overlayLayout(overlay, siteRoot) : committedLayout(siteRoot);
  const result = await syncContent({
    layout,
    vaultRoot: existingDir('vault', vaultRoot(), 'VAULT_DIR'),
    lifeVaultRoot: lifeVaultRoot(),
    resumeEngineRoot: resumeEngineRoot(),
    educationSource: createEducationSource({ file: educationExportFile() }),
    cacheDir: path.join(cacheDir(), 'images'),
    includeDrafts: values.drafts,
    snapshotDir: committedLayout(siteRoot).content,
  });

  if (values.report) {
    const report: SyncReport = { written: result.written, removed: result.removed };
    writeJson(values.report, report);
  }

  for (const warning of result.warnings) console.warn(`warning: ${warning}`);
  console.log(`Synced ${result.pages} pages from ${result.pagesRoot}`);
  console.log(`Synced ${result.writeups} writeups from ${result.writeupsRoot}`);
  console.log(`Prepared ${result.images} images; wrote ${result.written.length} files, removed ${result.removed.length}`);
  if (values.drafts) console.log(`Drafts included, written to ${path.relative(siteRoot, overlay)} (gitignored; never committed or deployed)`);
  return 0;
}

await exitWith('sync-content', values.check ? check : sync);
