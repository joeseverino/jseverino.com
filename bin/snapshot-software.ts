#!/usr/bin/env node
// Refresh the committed package registry snapshot (src/data/package-registry.json),
// the only source src/lib/software.ts reads for versions and monthly downloads:
// builds never call PyPI or npm, so one commit always builds the same site. Run
// it before a release of the site, or after publishing a package, and commit the
// result. It fails without writing when any lookup fails, so a registry outage
// cannot blank a number.
//
//   npm run snapshot:software

import fs from 'node:fs';
import { PACKAGES } from '../src/lib/software.config.ts';
import { cli } from './lib/args.ts';
import { snapshotPackages } from './lib/package-registry.ts';

cli({ usage: 'usage: node bin/snapshot-software.ts' });

const result = await snapshotPackages(Object.values(PACKAGES));
if (!result.ok) {
  console.error(`failed: nothing written.\n  ${result.failures.join('\n  ')}`);
  process.exit(1);
}
fs.writeFileSync('src/data/package-registry.json', `${JSON.stringify(result.snapshot, null, 2)}\n`);
console.log(`Wrote src/data/package-registry.json (${Object.keys(result.snapshot.packages).length} packages).`);
