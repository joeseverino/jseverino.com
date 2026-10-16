import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { siteRoot } from '../../src/lib/site-root.ts';
import { scratchDirs, write } from './helpers/fs.ts';

const scratch = scratchDirs('audit-test-');
after(scratch.cleanup);

const audit = (report: unknown, code: number) => {
  const bin = scratch.make();
  const npm = path.join(bin, 'npm');
  write(npm, '#!/usr/bin/env node\nprocess.stdout.write(process.env.AUDIT_STUB_REPORT); process.exit(Number(process.env.AUDIT_STUB_EXIT));\n');
  fs.chmodSync(npm, 0o755);
  return spawnSync(process.execPath, ['bin/audit.ts', '--json'], {
    cwd: siteRoot, encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, AUDIT_STUB_REPORT: JSON.stringify(report), AUDIT_STUB_EXIT: String(code) },
  });
};

test('npm errors and malformed reports cannot pass the advisory gate', () => {
  for (const report of [{ error: { code: 'E503' } }, {}, null, { vulnerabilities: [] }, { vulnerabilities: { broken: {} } }]) {
    const result = audit(report, 1);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /did not produce a report/);
  }
  assert.equal(audit({ vulnerabilities: {} }, 2).status, 1);
});

test('valid clean and vulnerability reports retain npm audit exit semantics', () => {
  const clean = audit({ vulnerabilities: {} }, 0);
  assert.equal(clean.status, 0, clean.stderr);
  assert.equal(JSON.parse(clean.stdout).ok, true);
  const finding = audit({ vulnerabilities: { example: { via: [{ name: 'example', severity: 'high', title: 'Test advisory', url: 'https://github.com/advisories/GHSA-test-test-test' }] } } }, 1);
  assert.equal(finding.status, 1);
  assert.equal(JSON.parse(finding.stdout).findings[0].status, 'unaccepted');
});
