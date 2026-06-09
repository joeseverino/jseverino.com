#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  SECURITY_FILE,
  SIGNING_EMAIL,
  SITE_ROOT,
  runGpg,
  stripSignature,
} from '../src/lib/security-txt.mjs';

try {
  const body = stripSignature(fs.readFileSync(SECURITY_FILE, 'utf8'));

  const result = runGpg(
    ['--clear-sign', '--local-user', SIGNING_EMAIL, '--armor', '--output', '-'],
    { input: body },
  );
  if (result.status !== 0) {
    throw new Error(`gpg --clear-sign failed (exit ${result.status}):\n${result.stderr}`);
  }

  fs.writeFileSync(SECURITY_FILE, result.stdout);
  console.log(`signed ${path.relative(SITE_ROOT, SECURITY_FILE)} with ${SIGNING_EMAIL}`);
} catch (error) {
  console.error(`sign-security: ${error.message}`);
  process.exit(1);
}
