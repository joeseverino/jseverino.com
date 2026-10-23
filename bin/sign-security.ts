#!/usr/bin/env node
// Clear-signs public/.well-known/security.txt with the security contact's GPG key.
//
//   node bin/sign-security.ts
import fs from 'node:fs';
import path from 'node:path';
import { siteRoot } from '../src/lib/site-root.ts';
import { cli, exitWith } from './lib/args.ts';
import { runGpg, SECURITY_FILE, SIGNING_EMAIL, stripSignature } from './lib/security-txt.ts';

cli({ usage: 'usage: node bin/sign-security.ts' });

await exitWith('sign-security', async () => {
  const body = stripSignature(fs.readFileSync(SECURITY_FILE, 'utf8'));
  const result = runGpg(['--clear-sign', '--local-user', SIGNING_EMAIL, '--armor', '--output', '-'], { input: body });
  if (result.code !== 0) throw new Error(`gpg --clear-sign failed (exit ${result.code}):\n${result.stderr}`);
  fs.writeFileSync(SECURITY_FILE, result.stdout);
  console.log(`signed ${path.relative(siteRoot, SECURITY_FILE)} with ${SIGNING_EMAIL}`);
  return 0;
});
