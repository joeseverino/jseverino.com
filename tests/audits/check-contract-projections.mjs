#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const checks = [
  ['contact OpenAPI', ['bin/sync-contact-openapi.mjs', '--check']],
  ['content schemas', ['bin/sync-content-contract.mjs', '--check']],
  ['embed CSS projection', ['bin/make-embed-bundle.mjs', '--check']],
];
for (const [name, args] of checks) {
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(`${name} is stale\n${result.stderr || result.stdout}`);
    process.exit(1);
  }
}
console.log('ok       generated API and CSS projections match their canonical sources');
