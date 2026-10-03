import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runAudits } from '../../bin/lib/audits.ts';
import { summarize } from '../../bin/lib/audit-summary.ts';
import type { Audit } from '../audits/registry.ts';
import { tempDir } from './helpers/fs.ts';

// An audit that waits `ms`, appends `id start` / `id end` to log, and exits `code`.
const audit = (id: string, ms: number, code = 0, extra: Partial<Audit> = {}, log = ''): Audit => ({
  id, label: id, name: id, asserts: '', phase: 'pre-build', gates: ['gate'], fix: '',
  exec: {
    cmd: process.execPath,
    args: ['-e', `const fs = require('node:fs'); const log = ${JSON.stringify(log)};
      if (log) fs.appendFileSync(log, '${id} start\\n');
      setTimeout(() => { if (log) fs.appendFileSync(log, '${id} end\\n'); process.exit(${code}); }, ${ms});`],
  },
  ...extra,
});

test('results report in registry order, whichever finishes first', async () => {
  const order: string[] = [];
  const results = await runAudits([audit('slow', 300), audit('fast', 10)], { onResult: (result) => order.push(result.id) });
  assert.deepEqual(order, ['slow', 'fast']);
  assert.deepEqual(results.map((result) => result.ok), [true, true]);
});

test('stopOnFailure reports through the first failure and stops what is still running', async () => {
  const started = Date.now();
  const results = await runAudits([audit('fails', 50, 1), audit('long', 20_000)], { stopOnFailure: true });
  assert.deepEqual(results.map((result) => [result.id, result.ok]), [['fails', false]]);
  assert.ok(Date.now() - started < 5_000, 'the long audit was stopped, not awaited');
});

test('audits sharing a lock never overlap', async () => {
  const log = path.join(tempDir('run-audits-'), 'log');
  await runAudits([audit('a', 150, 0, { lock: 'astro' }, log), audit('b', 10, 0, { lock: 'astro' }, log)]);
  assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n'), ['a start', 'a end', 'b start', 'b end']);
});

test('jsonArgs are appended only under SITE_JSON=1', async () => {
  const printsArgs: Audit = {
    ...audit('args', 0),
    exec: { cmd: process.execPath, args: ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', '--'], jsonArgs: ['--json'] },
  };
  const [plain] = await runAudits([printsArgs], { env: { SITE_JSON: '' } });
  const [json] = await runAudits([printsArgs], { env: { SITE_JSON: '1' } });
  assert.deepEqual(JSON.parse(plain?.stdout ?? ''), []);
  assert.deepEqual(JSON.parse(json?.stdout ?? ''), ['--json']);
});

test('the astro summary reads the same under the JSON logger', () => {
  const plain = 'Getting diagnostics...\nResult (63 files): \n- 0 errors\n- 0 warnings\n';
  const json = `${JSON.stringify({ message: 'Synced content', label: 'content', level: 'info' })}\n${plain}`;
  for (const output of [plain, json]) assert.equal(summarize({ summary: 'astro' }, output), '0 errors, 0 warnings');
});

test('a Playwright suite summarizes as its pass count', () => {
  assert.equal(summarize({}, 'Running 19 tests using 1 worker\n\n  19 passed (5.4s)\n'), '19 passed (5.4s)');
});
