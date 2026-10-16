import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AUDITS, auditsFor, publishAudits, diagnosticAudits } from '../../tests/audits/registry.ts';
import { siteRoot as root } from '../../src/lib/site-root.ts';

describe('audit registry', () => {
  test('ids are unique', () => {
    const ids = AUDITS.map((audit) => audit.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('every audit claims a gate', () => {
    for (const audit of AUDITS) assert.ok(audit.gates.length > 0, `${audit.id} claims no gate`);
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

describe('publishAudits', () => {
  const ids = (audits: { id: string }[]) => audits.map((audit) => audit.id);

  test('after the gate, drops exactly the audits the gate claims', () => {
    const all = ids(publishAudits('pre-build'));
    const after = ids(publishAudits('pre-build', { afterGate: true }));
    const gated = ids(auditsFor('gate'));
    assert.deepEqual(after, all.filter((id) => !gated.includes(id)));
    assert.ok(all.includes('repo-policy') && !after.includes('repo-policy'));
  });

  test('on the runner, leaves the edge suite to its own job', () => {
    assert.ok(ids(publishAudits('post-build')).includes('edge-tests'));
    assert.ok(!ids(publishAudits('post-build', { ci: true })).includes('edge-tests'));
  });
});

test('diagnosis without browsers keeps artifact audits and omits every served suite', () => {
  const full = diagnosticAudits('post-build');
  const selected = diagnosticAudits('post-build', { browsers: false });
  const omitted = full.filter((audit) => !selected.includes(audit)).map((audit) => audit.id);
  assert.deepEqual(omitted, ['edge-tests', 'browser-tests', 'visual-tests']);
  for (const id of ['html-check', 'weight-check', 'routes-check', 'seo-check']) {
    assert.ok(selected.some((audit) => audit.id === id), `${id} must still run`);
  }
  assert.deepEqual(full, auditsFor('diagnose', 'post-build'));
});
