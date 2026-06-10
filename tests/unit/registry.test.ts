// Shape validation for the audit registry (tests/audits/registry.mjs) — the
// single source every gate derives its checks from. The gates trust this
// inventory blindly, so the inventory itself is what gets verified here:
// well-formed entries, unique ids, valid gate/phase claims, and exec targets
// that actually exist on disk.
//
//   npm run test:unit

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUDITS, auditsFor } from '../../tests/audits/registry.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VALID_GATES = ['publish', 'diagnose', 'release'];
const VALID_PHASES = ['pre-build', 'post-build'];

describe('audit registry', () => {
  test('every entry carries the required fields', () => {
    for (const audit of AUDITS) {
      const record = audit as Record<string, unknown>;
      for (const field of ['id', 'label', 'name', 'phase', 'exec', 'gates', 'fix']) {
        assert.ok(record[field], `${audit.id ?? '<missing id>'} is missing ${field}`);
      }
      assert.ok(typeof audit.exec.cmd === 'string' && audit.exec.cmd.length > 0, `${audit.id} exec.cmd`);
      assert.ok(Array.isArray(audit.exec.args), `${audit.id} exec.args`);
    }
  });

  test('ids are unique', () => {
    const ids = AUDITS.map((audit) => audit.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('phases and gates only use known values', () => {
    for (const audit of AUDITS) {
      assert.ok(VALID_PHASES.includes(audit.phase), `${audit.id} phase "${audit.phase}"`);
      assert.ok(audit.gates.length > 0, `${audit.id} claims no gate`);
      for (const gate of audit.gates) {
        assert.ok(VALID_GATES.includes(gate), `${audit.id} gate "${gate}"`);
      }
    }
  });

  test('the complete gate (diagnose) runs every audit', () => {
    for (const audit of AUDITS) {
      assert.ok(audit.gates.includes('diagnose'), `${audit.id} is invisible to diagnose`);
    }
  });

  test('every node-script exec target exists on disk', () => {
    for (const audit of AUDITS) {
      if (audit.exec.cmd !== 'node') continue;
      const script = audit.exec.args.find((arg) => arg.endsWith('.mjs') || arg.endsWith('.ts'));
      if (!script || script.includes('*')) continue;
      assert.ok(fs.existsSync(path.join(root, script)), `${audit.id} exec target ${script} does not exist`);
    }
  });

  test('timeouts, when set, are positive numbers', () => {
    for (const audit of AUDITS) {
      if (audit.timeout === undefined) continue;
      assert.ok(Number.isFinite(audit.timeout) && audit.timeout > 0, `${audit.id} timeout`);
    }
  });

  test('auditsFor filters by gate and phase', () => {
    const publishPre = auditsFor('publish', 'pre-build');
    assert.ok(publishPre.length > 0);
    for (const audit of publishPre) {
      assert.ok(audit.gates.includes('publish'));
      assert.equal(audit.phase, 'pre-build');
    }
    assert.equal(auditsFor('diagnose').length, AUDITS.length);
  });
});
