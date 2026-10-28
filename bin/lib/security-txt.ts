import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SITE, SITE_ORIGIN } from '../../src/lib/site-config.ts';
import { siteRoot } from '../../src/lib/site-root.ts';
import { type SpawnOptions, type SpawnResult, spawnResult } from './run.ts';

// Shared by the security.txt signer (bin/sign-security.ts) and verifier (tests/audits/check-security-txt.ts).

export const SECURITY_FILE = path.join(siteRoot, 'public/.well-known/security.txt');
export const WKD_DIR = path.join(siteRoot, 'public/.well-known/openpgpkey/hu');
export const SIGNING_EMAIL = `security@${SITE.domain}`;
export const EXPECTED_CANONICAL = `${SITE_ORIGIN}/.well-known/security.txt`;
export const REQUIRED_FIELDS = ['Contact', 'Encryption', 'Expires', 'Canonical', 'Policy'];

// The monthly scheduled check fails, and GitHub emails the failure, at least
// twice before the file lapses.
export const EXPIRES_MIN_DAYS = 60;

// Whole days from `now` until an Expires value. RFC 9116 requires an RFC 3339
// date-time, and anything else throws.
export function expiresInDays(expires: string, now = Temporal.Now.instant()): number {
  return Math.floor(now.until(Temporal.Instant.from(expires)).total('days'));
}

// Why an Expires value fails the gate at `now`, or undefined when it passes.
export function expiryProblem(expires: string, now = Temporal.Now.instant()): string | undefined {
  let days: number;
  try {
    days = expiresInDays(expires, now);
  } catch {
    return `security.txt Expires is not an RFC 3339 date-time: ${expires}`;
  }
  if (days < 0) return `security.txt Expires (${expires}) is in the past`;
  if (days < EXPIRES_MIN_DAYS) return `security.txt Expires in ${days}d (< ${EXPIRES_MIN_DAYS}d). Bump it, re-sign, commit.`;
  return undefined;
}

export function stripSignature(text: string): string {
  const begin = text.indexOf('-----BEGIN PGP SIGNED MESSAGE-----');
  if (begin === -1) return `${text.trim()}\n`;

  const headerEnd = text.indexOf('\n\n', begin);
  if (headerEnd === -1) throw new Error('malformed PGP signed message: no body separator');
  const sigStart = text.indexOf('-----BEGIN PGP SIGNATURE-----', headerEnd);
  if (sigStart === -1) throw new Error('malformed PGP signed message: no signature block');

  return `${text.slice(headerEnd + 2, sigStart).replace(/\s+$/, '')}\n`;
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

// Verification trusts only the public keys shipped with the checkout. It never
// reads the author's GPG config or keyring, and needs no signing agent.
export function verifySecuritySignature(file: string, keyDirectory = WKD_DIR): SpawnResult {
  using directory = fs.mkdtempDisposableSync(path.join(os.tmpdir(), 'site-signature-'));
  const options = ['--no-options', '--homedir', directory.path, '--batch', '--no-autostart', '--no-auto-key-retrieve'];
  const keys = fs
    .readdirSync(keyDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(keyDirectory, entry.name));
  if (!keys.length) throw new Error('No committed WKD public keys available for signature verification.');
  const imported = runGpg([...options, '--import', ...keys]);
  if (imported.code !== 0) return imported;
  return runGpg([...options, '--verify', '--status-fd=1', file]);
}
