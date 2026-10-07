import path from 'node:path';
import { SITE, SITE_ORIGIN } from '../../src/lib/site-config.ts';
import { siteRoot } from '../../src/lib/site-root.ts';
import { spawnResult, type SpawnOptions, type SpawnResult } from './run.ts';

// Shared by the security.txt signer (bin/sign-security.ts) and verifier (tests/audits/check-security-txt.ts).

export const SECURITY_FILE = path.join(siteRoot, 'public/.well-known/security.txt');
export const WKD_DIR = path.join(siteRoot, 'public/.well-known/openpgpkey/hu');
export const SIGNING_EMAIL = `security@${SITE.domain}`;
export const EXPECTED_CANONICAL = `${SITE_ORIGIN}/.well-known/security.txt`;
export const REQUIRED_FIELDS = ['Contact', 'Encryption', 'Expires', 'Canonical', 'Policy'];

export function stripSignature(text: string): string {
  const begin = text.indexOf('-----BEGIN PGP SIGNED MESSAGE-----');
  if (begin === -1) return text.trim() + '\n';

  const headerEnd = text.indexOf('\n\n', begin);
  if (headerEnd === -1) throw new Error('malformed PGP signed message: no body separator');
  const sigStart = text.indexOf('-----BEGIN PGP SIGNATURE-----', headerEnd);
  if (sigStart === -1) throw new Error('malformed PGP signed message: no signature block');

  return text.slice(headerEnd + 2, sigStart).replace(/\s+$/, '') + '\n';
}

export function parseFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z-]+):\s*(.+?)\s*$/);
    if (match?.[1] && match[2]) fields[match[1]] = match[2];
  }
  return fields;
}

export function runGpg(args: readonly string[], options: Pick<SpawnOptions, 'input' | 'env'> = {}): SpawnResult {
  const result = spawnResult('gpg', args, options);
  if (result.error?.code === 'ENOENT') {
    throw new Error('gpg is not installed or not in PATH. Install GnuPG to sign or verify security.txt.');
  }
  return result;
}
