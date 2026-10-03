#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  SECURITY_FILE,
  SIGNING_EMAIL,
  runGpg,
  stripSignature,
} from './lib/security-txt.ts';
import { siteRoot } from '../src/lib/site-root.ts';

try {
  const body = stripSignature(fs.readFileSync(SECURITY_FILE, 'utf8'));

  const result = runGpg(
    ['--clear-sign', '--local-user', SIGNING_EMAIL, '--armor', '--output', '-'],
    { input: body },
  );
  if (result.code !== 0) {
    throw new Error(`gpg --clear-sign failed (exit ${result.code}):\n${result.stderr}`);
  }

  fs.writeFileSync(SECURITY_FILE, result.stdout);
  console.log(`signed ${path.relative(siteRoot, SECURITY_FILE)} with ${SIGNING_EMAIL}`);
} catch (error) {
  console.error(`sign-security: ${(error as Error).message}`);
  process.exit(1);
}
