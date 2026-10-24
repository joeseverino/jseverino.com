import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { annotation } from '../../bin/lib/step-summary.ts';

describe('annotation', () => {
  test('escapes data and properties so text cannot forge a workflow command', () => {
    assert.equal(annotation('error', 'gate: a, b', '100% done\r\n::warning::forged'), '::error title=gate%3A a%2C b::100%25 done%0D%0A::warning::forged');
  });

  test('plain text passes through unchanged', () => {
    assert.equal(annotation('notice', 'deploy-verify', 'all routes ok'), '::notice title=deploy-verify::all routes ok');
  });
});
