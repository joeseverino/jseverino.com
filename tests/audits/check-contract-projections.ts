#!/usr/bin/env node
// Every generated projection matches its canonical source (each sync script re-derives with --check).
import { runSync } from '../../bin/lib/run.ts';
import { siteRoot } from '../../src/lib/site-root.ts';
import { errorMessage } from '../../src/lib/error-message.ts';

const checks: [name: string, script: string][] = [
  ['brand tokens', 'bin/sync-tokens.ts'],
  ['contact OpenAPI', 'bin/sync-contact-openapi.ts'],
  ['content schemas', 'bin/sync-content-contract.ts'],
  ['embed CSS', 'bin/make-embed-bundle.ts'],
  ['edge site identity', 'bin/sync-edge-site.ts'],
];
for (const [name, script] of checks) {
  try {
    runSync(process.execPath, [script, '--check'], { cwd: siteRoot });
  } catch (error) {
    console.error(`${name} is stale\n${errorMessage(error)}`);
    process.exit(1);
  }
}
console.log('ok       generated brand, API, schema, CSS, and edge identity projections match their canonical sources');
