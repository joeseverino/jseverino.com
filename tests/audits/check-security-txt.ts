import fs from 'node:fs';
import path from 'node:path';
import {
  EXPECTED_CANONICAL,
  REQUIRED_FIELDS,
  SECURITY_FILE,
  WKD_DIR,
  expiryProblem,
  parseFields,
  verifySecuritySignature,
  stripSignature,
} from '../../bin/lib/security-txt.ts';
import { siteRoot } from '../../src/lib/site-root.ts';
import { SITE } from '../../src/lib/site-config.ts';
import { finish } from './lib.ts';
import { errorMessage } from '../../src/lib/error-message.ts';

const wkdEncryptionRe = new RegExp(`^https://${RegExp.escape(SITE.domain)}/\\.well-known/openpgpkey/hu/([a-z0-9]+)$`);

// Each step needs the one before it, so the first problem ends the check.
function fail(message: string): never {
  throw new Error(message);
}

function check(): string {
  if (!fs.existsSync(SECURITY_FILE)) fail(`missing ${path.relative(siteRoot, SECURITY_FILE)}`);
  const raw = fs.readFileSync(SECURITY_FILE, 'utf8');

  if (!raw.includes('-----BEGIN PGP SIGNED MESSAGE-----')) {
    fail('security.txt is not PGP-signed. Run `mise run sign:security`.');
  }

  const verify = verifySecuritySignature(SECURITY_FILE);
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

  const expired = expiryProblem(Expires);
  if (expired) fail(expired);
  const daysUntil = Math.floor((new Date(Expires).getTime() - Date.now()) / 86_400_000);

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

  return `signed, ${REQUIRED_FIELDS.length} fields present, expires in ${daysUntil}d, WKD file present`;
}

let problems: string[] = [];
let ok = '';
try {
  ok = check();
} catch (error) {
  problems = [errorMessage(error)];
}
finish(problems, ok, {
  heading: 'check-security-txt:',
  fix: 'fix: run `mise run sign:security` to sign or re-sign public/.well-known/security.txt with the security@ key',
});
