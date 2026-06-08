#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const securityFile = path.join(siteRoot, 'public/.well-known/security.txt');
const wkdDir = path.join(siteRoot, 'public/.well-known/openpgpkey/hu');
const signingEmail = 'security@jseverino.com';
const expectedCanonical = 'https://jseverino.com/.well-known/security.txt';
const expiresWarnDays = 30;
const requiredFields = ['Contact', 'Encryption', 'Expires', 'Canonical', 'Policy'];

function stripSignature(text) {
  const begin = text.indexOf('-----BEGIN PGP SIGNED MESSAGE-----');
  if (begin === -1) return text.trim() + '\n';

  const headerEnd = text.indexOf('\n\n', begin);
  if (headerEnd === -1) throw new Error('malformed PGP signed message: no body separator');
  const sigStart = text.indexOf('-----BEGIN PGP SIGNATURE-----', headerEnd);
  if (sigStart === -1) throw new Error('malformed PGP signed message: no signature block');

  return text.slice(headerEnd + 2, sigStart).replace(/\s+$/, '') + '\n';
}

function runGpg(args, options = {}) {
  const result = spawnSync('gpg', args, { encoding: 'utf8', ...options });
  if (result.error?.code === 'ENOENT') {
    fail('gpg is not installed or not in PATH. Install GnuPG to sign or verify security.txt.');
  }
  return result;
}

function sign() {
  const raw = fs.readFileSync(securityFile, 'utf8');
  const body = stripSignature(raw);

  const result = runGpg(
    ['--clear-sign', '--local-user', signingEmail, '--armor', '--output', '-'],
    { input: body },
  );
  if (result.status !== 0) {
    fail(`gpg --clear-sign failed (exit ${result.status}):\n${result.stderr}`);
  }

  fs.writeFileSync(securityFile, result.stdout);
  log(`signed ${path.relative(siteRoot, securityFile)} with ${signingEmail}`);
}

function check() {
  if (!fs.existsSync(securityFile)) fail(`missing ${path.relative(siteRoot, securityFile)}`);
  const raw = fs.readFileSync(securityFile, 'utf8');

  if (!raw.includes('-----BEGIN PGP SIGNED MESSAGE-----')) {
    fail('security.txt is not PGP-signed. Run `npm run sign:security`.');
  }

  const verify = runGpg(['--verify', '--status-fd=1', securityFile]);
  if (verify.status !== 0) {
    fail(`gpg signature verification failed:\n${verify.stderr}`);
  }
  if (!verify.stdout.includes('GOODSIG') && !verify.stdout.includes('VALIDSIG')) {
    fail(`gpg verification reported no GOODSIG status:\n${verify.stdout}\n${verify.stderr}`);
  }

  const body = stripSignature(raw);
  const fields = parseFields(body);

  const missing = requiredFields.filter((field) => !fields[field]);
  if (missing.length > 0) fail(`security.txt is missing required field(s): ${missing.join(', ')}`);

  const expires = new Date(fields.Expires);
  if (Number.isNaN(expires.getTime())) fail(`security.txt Expires is not a parseable date: ${fields.Expires}`);
  const msUntil = expires.getTime() - Date.now();
  const daysUntil = Math.floor(msUntil / 86_400_000);
  if (msUntil <= 0) fail(`security.txt Expires (${fields.Expires}) is in the past`);
  if (daysUntil < expiresWarnDays) {
    fail(`security.txt Expires in ${daysUntil}d (< ${expiresWarnDays}d). Bump it, re-sign, commit.`);
  }

  if (fields.Canonical !== expectedCanonical) {
    fail(`security.txt Canonical is "${fields.Canonical}"; expected "${expectedCanonical}"`);
  }

  const wkdMatch = fields.Encryption.match(
    /^https:\/\/jseverino\.com\/\.well-known\/openpgpkey\/hu\/([a-z0-9]+)$/,
  );
  if (!wkdMatch) {
    fail(`security.txt Encryption is not a WKD URL on jseverino.com: ${fields.Encryption}`);
  }
  const wkdFile = path.join(wkdDir, wkdMatch[1]);
  if (!fs.existsSync(wkdFile)) {
    fail(`Encryption points at ${fields.Encryption} but local file is missing: ${path.relative(siteRoot, wkdFile)}`);
  }

  log(`ok       signed, ${requiredFields.length} fields present, expires in ${daysUntil}d, WKD file present`);
}

function parseFields(body) {
  const fields = {};
  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z-]+):\s*(.+?)\s*$/);
    if (match) fields[match[1]] = match[2];
  }
  return fields;
}

function log(message) {
  console.log(message);
}

function fail(message) {
  console.error(`security.txt: ${message}`);
  process.exit(1);
}

const command = process.argv[2];
if (command === 'sign') sign();
else if (command === 'check') check();
else {
  console.error('Usage: node tests/audits/security-txt.mjs <sign|check>');
  process.exit(2);
}
