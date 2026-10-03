#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  EXPECTED_CANONICAL,
  REQUIRED_FIELDS,
  SECURITY_FILE,
  WKD_DIR,
  parseFields,
  runGpg,
  stripSignature,
} from '../../bin/lib/security-txt.ts';
import { siteRoot } from '../../src/lib/site-root.ts';
import { SITE } from '../../src/lib/site-config.ts';
import { abort } from './lib.ts';

const wkdEncryptionRe = new RegExp(
  `^https://${RegExp.escape(SITE.domain)}/\\.well-known/openpgpkey/hu/([a-z0-9]+)$`,
);

const expiresWarnDays = 30;

const fail: (message: string) => never = (message) => abort('check-security-txt', message);

try {
  if (!fs.existsSync(SECURITY_FILE)) fail(`missing ${path.relative(siteRoot, SECURITY_FILE)}`);
  const raw = fs.readFileSync(SECURITY_FILE, 'utf8');

  if (!raw.includes('-----BEGIN PGP SIGNED MESSAGE-----')) {
    fail('security.txt is not PGP-signed. Run `npm run sign:security`.');
  }

  const verify = runGpg(['--verify', '--status-fd=1', SECURITY_FILE]);
  if (verify.code !== 0) {
    fail(`gpg signature verification failed:\n${verify.stderr}`);
  }
  if (!verify.stdout.includes('GOODSIG') && !verify.stdout.includes('VALIDSIG')) {
    fail(`gpg verification reported no GOODSIG status:\n${verify.stdout}\n${verify.stderr}`);
  }

  const fields = parseFields(stripSignature(raw));
  const { Expires = '', Canonical, Encryption = '' } = fields;

  const missing = REQUIRED_FIELDS.filter((field) => !fields[field]);
  if (missing.length > 0) fail(`security.txt is missing required field(s): ${missing.join(', ')}`);

  const expires = new Date(Expires);
  if (Number.isNaN(expires.getTime())) fail(`security.txt Expires is not a parseable date: ${Expires}`);
  const msUntil = expires.getTime() - Date.now();
  const daysUntil = Math.floor(msUntil / 86_400_000);
  if (msUntil <= 0) fail(`security.txt Expires (${Expires}) is in the past`);
  if (daysUntil < expiresWarnDays) {
    fail(`security.txt Expires in ${daysUntil}d (< ${expiresWarnDays}d). Bump it, re-sign, commit.`);
  }

  if (Canonical !== EXPECTED_CANONICAL) {
    fail(`security.txt Canonical is "${Canonical}"; expected "${EXPECTED_CANONICAL}"`);
  }

  const wkdKey = Encryption.match(wkdEncryptionRe)?.[1];
  if (!wkdKey) {
    fail(`security.txt Encryption is not a WKD URL on ${SITE.domain}: ${Encryption}`);
  }
  const wkdFile = path.join(WKD_DIR, wkdKey);
  if (!fs.existsSync(wkdFile)) {
    fail(`Encryption points at ${Encryption} but local file is missing: ${path.relative(siteRoot, wkdFile)}`);
  }

  console.log(`ok       signed, ${REQUIRED_FIELDS.length} fields present, expires in ${daysUntil}d, WKD file present`);
} catch (error) {
  fail((error as Error).message);
}
