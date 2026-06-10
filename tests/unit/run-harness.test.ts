// Unit tests for the shared gate harness (bin/lib/run.mjs). These cover the
// failure modes a green gate run never exercises: non-zero exits, a binary
// that does not exist, and a command that hangs past its timeout. All three
// must resolve as failed results — never hang, never reject — because every
// gate (diagnose, publish-check, release-check) sits on this wrapper.
//
//   npm run test:unit

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { run, stripAnsi } from '../../bin/lib/run.mjs';

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

describe('stripAnsi()', () => {
  test('removes color codes and leaves text intact', () => {
    assert.equal(stripAnsi('\x1b[1m\x1b[32mok\x1b[0m done'), 'ok done');
  });
});
