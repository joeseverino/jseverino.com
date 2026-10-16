import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SECURITY_FILE, verifySecuritySignature } from '../../bin/lib/security-txt.ts';
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

  const valid = verifySecuritySignature(SECURITY_FILE);
  assert.equal(valid.code, 0, valid.stderr);
  assert.match(valid.stdout, /\[GNUPG:\] VALIDSIG /);

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
