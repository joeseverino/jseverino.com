// The process harness failure modes a green run never hits: non-zero exit, missing binary, timeout.
// All must resolve as failed results, never hang or reject.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../../bin/lib/run.ts';

describe('run()', () => {
  test('captures stdout and stderr from a passing command', async () => {
    const result = await run(process.execPath, ['-e', 'console.log("out"); console.error("err")']);
    assert.equal(result.code, 0);
    assert.equal(result.stdout.trim(), 'out');
    assert.equal(result.stderr.trim(), 'err');
    assert.equal(result.timedOut, false);
  });

  test('passes through a non-zero exit code', async () => {
    const result = await run(process.execPath, ['-e', 'process.exit(3)']);
    assert.equal(result.code, 3);
  });

  test('reports a missing binary as a failed result instead of hanging', async () => {
    const result = await run('definitely-not-a-binary-xyz', []);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /failed to start/);
  });

  test('kills a hung command at the timeout and marks the result', async () => {
    const result = await run(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], { timeout: 500 });
    assert.notEqual(result.code, 0);
    assert.equal(result.timedOut, true);
    assert.match(result.stderr, /timed out after/);
  });

  test('ends a command that ignores SIGTERM at the timeout', async () => {
    const result = await run(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setTimeout(() => {}, 20_000)"], { timeout: 500 });
    assert.equal(result.timedOut, true);
    assert.ok(result.duration < 3_000, `ran ${result.duration}ms`);
  });

  test('a command that exits on its own has not timed out', async () => {
    const result = await run(process.execPath, ['-e', 'process.kill(process.pid, "SIGTERM")'], { timeout: 5_000 });
    assert.notEqual(result.code, 0);
    assert.equal(result.timedOut, false);
  });

  test('merges env over process.env', async () => {
    const result = await run(process.execPath, ['-e', 'console.log(process.env.GATE_TEST_VAR)'], {
      env: { GATE_TEST_VAR: 'present' },
    });
    assert.equal(result.stdout.trim(), 'present');
  });

  test('provides ANSI-stripped combined output', async () => {
    const result = await run(process.execPath, ['-e', String.raw`console.log('\x1b[32mgreen\x1b[0m')`]);
    assert.match(result.output, /green/);
    assert.doesNotMatch(result.output, /\x1b/);
  });
});
