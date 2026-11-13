import fs from 'node:fs';
import path from 'node:path';
import {
  EXPECTED_CANONICAL,
  expiresInDays,
  expiryProblem,
  parseFields,
  REQUIRED_FIELDS,
  SECURITY_FILE,
  stripSignature,
  verifySecuritySignature,
  WKD_DIR,
} from '../../bin/lib/security-txt.ts';
import { SITE } from '../../src/lib/site-config.ts';
import { siteRoot } from '../../src/lib/site-root.ts';
import { abort, finish } from './lib.ts';

const wkdEncryptionRe = new RegExp(`^https://${RegExp.escape(SITE.domain)}/\\.well-known/openpgpkey/hu/([a-z0-9]+)$`);

const SIGN = 'fix: run `mise run sign:security` to sign or re-sign public/.well-known/security.txt with the security@ key';

if (!fs.existsSync(SECURITY_FILE)) abort('check-security-txt', `missing ${path.relative(siteRoot, SECURITY_FILE)}`, SIGN);
const raw = fs.readFileSync(SECURITY_FILE, 'utf8');
if (!raw.includes('-----BEGIN PGP SIGNED MESSAGE-----')) abort('check-security-txt', 'security.txt is not PGP-signed', SIGN);
const verify = verifySecuritySignature(SECURITY_FILE);
if (verify.code !== 0) abort('check-security-txt', `gpg signature verification failed:\n${verify.stderr}`, SIGN);
if (!verify.stdout.includes('GOODSIG') && !verify.stdout.includes('VALIDSIG')) {
  abort('check-security-txt', `gpg verification reported no GOODSIG status:\n${verify.stdout}\n${verify.stderr}`, SIGN);
}

const fields = parseFields(stripSignature(raw));
const { Expires = '', Canonical, Encryption = '' } = fields;
const problems: string[] = [];

const missing = REQUIRED_FIELDS.filter((field) => !fields[field]);
if (missing.length > 0) problems.push(`missing required field(s): ${missing.join(', ')}`);
const expired = expiryProblem(Expires);
if (expired) problems.push(expired);
if (Canonical !== EXPECTED_CANONICAL) problems.push(`Canonical is "${Canonical}"; expected "${EXPECTED_CANONICAL}"`);
const wkdKey = Encryption.match(wkdEncryptionRe)?.[1];
if (!wkdKey) problems.push(`Encryption is not a WKD URL on ${SITE.domain}: ${Encryption}`);
else if (!fs.existsSync(path.join(WKD_DIR, wkdKey))) {
  problems.push(`Encryption points at ${Encryption} but ${path.relative(siteRoot, path.join(WKD_DIR, wkdKey))} is missing`);
}

finish(problems, `signed, ${REQUIRED_FIELDS.length} fields present, expires in ${expiresInDays(Expires)}d, WKD file present`, {
  heading: 'check-security-txt: security.txt is wrong:',
  fix: SIGN,
});
