import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, type TestContext, test } from 'node:test';
import { expiryProblem, SECURITY_FILE, verifySecuritySignature } from '../../bin/lib/security-txt.ts';
import { scratchDirs } from './helpers/fs.ts';

const scratch = scratchDirs('signature-test-');
after(scratch.cleanup);

// GNUPGHOME points at a directory that must never appear, so a verification that
// reads or writes the personal keyring fails the test.
function isolatedKeyring(t: TestContext): string {
  const home = path.join(scratch.make(), 'personal-keyring-must-not-be-created');
  const previous = process.env.GNUPGHOME;
  process.env.GNUPGHOME = home;
  t.after(() => {
    if (previous === undefined) delete process.env.GNUPGHOME;
    else process.env.GNUPGHOME = previous;
  });
  return home;
}

test('a modified file fails verification against the committed key, without touching the personal keyring', (t) => {
  const home = isolatedKeyring(t);
  const tampered = path.join(scratch.make(), 'tampered.txt');
  fs.writeFileSync(tampered, fs.readFileSync(SECURITY_FILE, 'utf8').replace('Contact:', 'Changed:'));
  const invalid = verifySecuritySignature(tampered);
  assert.notEqual(invalid.code, 0);
  assert.match(invalid.stdout, /\[GNUPG:\] BADSIG /);
  assert.equal(fs.existsSync(home), false);
});

test('verification refuses to run without a committed WKD key', (t) => {
  isolatedKeyring(t);
  assert.throws(() => verifySecuritySignature(SECURITY_FILE, scratch.make()), /No committed WKD public keys/);
});

test('the gate fails from 60 days before Expires, so the scheduled run fails before the file lapses', () => {
  const now = Temporal.Instant.from('2026-01-01T00:00:00Z');
  assert.equal(expiryProblem('2026-03-03T00:00:00Z', now), undefined, '61 days out passes');
  assert.match(expiryProblem('2026-02-25T00:00:00Z', now) ?? '', /55d \(< 60d\)/);
  assert.match(expiryProblem('2025-12-31T00:00:00Z', now) ?? '', /in the past/);
  assert.match(expiryProblem('soon', now) ?? '', /not an RFC 3339 date-time/);
  assert.match(expiryProblem('2026-06-01', now) ?? '', /not an RFC 3339 date-time/, 'a date without a time and offset fails');
});
