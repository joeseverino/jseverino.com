import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { expiryProblem, SECURITY_FILE, verifySecuritySignature } from '../../bin/lib/security-txt.ts';
import { tempDir } from './helpers/fs.ts';

test('signature verification ignores the personal keyring and rejects modified content', (t) => {
  const directory = tempDir('signature-test-');
  const previous = process.env.GNUPGHOME;
  process.env.GNUPGHOME = path.join(directory, 'personal-keyring-must-not-be-created');
  t.after(() => {
    if (previous === undefined) delete process.env.GNUPGHOME;
    else process.env.GNUPGHOME = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const tampered = path.join(directory, 'tampered.txt');
  const original = fs.readFileSync(SECURITY_FILE, 'utf8');
  fs.writeFileSync(tampered, original.replace('Contact:', 'Changed:'));
  const invalid = verifySecuritySignature(tampered);
  assert.notEqual(invalid.code, 0);
  assert.match(invalid.stdout, /\[GNUPG:\] BADSIG /);
  assert.equal(fs.existsSync(process.env.GNUPGHOME), false);

  const emptyKeys = path.join(directory, 'empty-keys');
  fs.mkdirSync(emptyKeys);
  assert.throws(() => verifySecuritySignature(SECURITY_FILE, emptyKeys), /No committed WKD public keys/);
});

test('the gate fails from 60 days before Expires, so the scheduled run fails before the file lapses', () => {
  const now = Temporal.Instant.from('2026-01-01T00:00:00Z');
  assert.equal(expiryProblem('2026-03-03T00:00:00Z', now), undefined, '61 days out passes');
  assert.match(expiryProblem('2026-02-25T00:00:00Z', now) ?? '', /55d \(< 60d\)/);
  assert.match(expiryProblem('2025-12-31T00:00:00Z', now) ?? '', /in the past/);
  assert.match(expiryProblem('soon', now) ?? '', /not an RFC 3339 date-time/);
  assert.match(expiryProblem('2026-06-01', now) ?? '', /not an RFC 3339 date-time/, 'a date without a time and offset fails');
});
