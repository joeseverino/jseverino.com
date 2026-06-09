import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Shared, side-effect-free helpers for the security.txt signer (bin/sign-security.mjs)
// and verifier (tests/audits/check-security-txt.mjs). Both must agree on how the
// signed body is extracted, so that logic lives here once.

export const SITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SECURITY_FILE = path.join(SITE_ROOT, 'public/.well-known/security.txt');
export const WKD_DIR = path.join(SITE_ROOT, 'public/.well-known/openpgpkey/hu');
export const SIGNING_EMAIL = 'security@jseverino.com';
export const EXPECTED_CANONICAL = 'https://jseverino.com/.well-known/security.txt';
export const REQUIRED_FIELDS = ['Contact', 'Encryption', 'Expires', 'Canonical', 'Policy'];

export function stripSignature(text) {
  const begin = text.indexOf('-----BEGIN PGP SIGNED MESSAGE-----');
  if (begin === -1) return text.trim() + '\n';

  const headerEnd = text.indexOf('\n\n', begin);
  if (headerEnd === -1) throw new Error('malformed PGP signed message: no body separator');
  const sigStart = text.indexOf('-----BEGIN PGP SIGNATURE-----', headerEnd);
  if (sigStart === -1) throw new Error('malformed PGP signed message: no signature block');

  return text.slice(headerEnd + 2, sigStart).replace(/\s+$/, '') + '\n';
}

export function parseFields(body) {
  const fields = {};
  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z-]+):\s*(.+?)\s*$/);
    if (match) fields[match[1]] = match[2];
  }
  return fields;
}

export function runGpg(args, options = {}) {
  const result = spawnSync('gpg', args, { encoding: 'utf8', ...options });
  if (result.error?.code === 'ENOENT') {
    throw new Error('gpg is not installed or not in PATH. Install GnuPG to sign or verify security.txt.');
  }
  return result;
}
