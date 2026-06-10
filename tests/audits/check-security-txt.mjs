#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  EXPECTED_CANONICAL,
  REQUIRED_FIELDS,
  SECURITY_FILE,
  SITE_ROOT,
  WKD_DIR,
  parseFields,
  runGpg,
  stripSignature,
} from '../../src/lib/security-txt.mjs';
import { SITE } from '../../src/lib/site-config.mjs';
import { escapeRegExp } from '../../src/lib/escape-regexp.mjs';

const wkdEncryptionRe = new RegExp(
  `^https://${escapeRegExp(SITE.domain)}/\\.well-known/openpgpkey/hu/([a-z0-9]+)$`,
);

const expiresWarnDays = 30;

function fail(message) {
  console.error(`check-security-txt: ${message}`);
  process.exit(1);
}

try {
  if (!fs.existsSync(SECURITY_FILE)) fail(`missing ${path.relative(SITE_ROOT, SECURITY_FILE)}`);
  const raw = fs.readFileSync(SECURITY_FILE, 'utf8');

  if (!raw.includes('-----BEGIN PGP SIGNED MESSAGE-----')) {
    fail('security.txt is not PGP-signed. Run `npm run sign:security`.');
  }

  const verify = runGpg(['--verify', '--status-fd=1', SECURITY_FILE]);
  if (verify.status !== 0) {
    fail(`gpg signature verification failed:\n${verify.stderr}`);
  }
  if (!verify.stdout.includes('GOODSIG') && !verify.stdout.includes('VALIDSIG')) {
    fail(`gpg verification reported no GOODSIG status:\n${verify.stdout}\n${verify.stderr}`);
  }

  const fields = parseFields(stripSignature(raw));

  const missing = REQUIRED_FIELDS.filter((field) => !fields[field]);
  if (missing.length > 0) fail(`security.txt is missing required field(s): ${missing.join(', ')}`);

  const expires = new Date(fields.Expires);
  if (Number.isNaN(expires.getTime())) fail(`security.txt Expires is not a parseable date: ${fields.Expires}`);
  const msUntil = expires.getTime() - Date.now();
  const daysUntil = Math.floor(msUntil / 86_400_000);
  if (msUntil <= 0) fail(`security.txt Expires (${fields.Expires}) is in the past`);
  if (daysUntil < expiresWarnDays) {
    fail(`security.txt Expires in ${daysUntil}d (< ${expiresWarnDays}d). Bump it, re-sign, commit.`);
  }

  if (fields.Canonical !== EXPECTED_CANONICAL) {
    fail(`security.txt Canonical is "${fields.Canonical}"; expected "${EXPECTED_CANONICAL}"`);
  }

  const wkdMatch = fields.Encryption.match(wkdEncryptionRe);
  if (!wkdMatch) {
    fail(`security.txt Encryption is not a WKD URL on ${SITE.domain}: ${fields.Encryption}`);
  }
  const wkdFile = path.join(WKD_DIR, wkdMatch[1]);
  if (!fs.existsSync(wkdFile)) {
    fail(`Encryption points at ${fields.Encryption} but local file is missing: ${path.relative(SITE_ROOT, wkdFile)}`);
  }

  console.log(`ok       signed, ${REQUIRED_FIELDS.length} fields present, expires in ${daysUntil}d, WKD file present`);
} catch (error) {
  fail(error.message);
}
