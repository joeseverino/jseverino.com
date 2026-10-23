#!/usr/bin/env node

// Refresh src/data/package-registry.json, the only source src/lib/software.ts reads
// (builds never call PyPI or npm). Fails without writing if any lookup fails.
//
//   mise run snapshot:software

import { writeJson } from '../src/lib/json.ts';
import { fromRoot } from '../src/lib/site-root.ts';
import { PACKAGES } from '../src/lib/software.config.ts';
import { cli } from './lib/args.ts';
import { snapshotPackages } from './lib/package-registry.ts';

cli({ usage: 'usage: node bin/snapshot-software.ts' });

const result = await snapshotPackages(Object.values(PACKAGES));
if (!result.ok) {
  console.error(`failed: nothing written.\n  ${result.failures.join('\n  ')}`);
  process.exit(1);
}
writeJson(fromRoot('src/data/package-registry.json'), result.snapshot);
console.log(`Wrote src/data/package-registry.json (${Object.keys(result.snapshot.packages).length} packages).`);
