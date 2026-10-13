import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { validate, type JsonSchema } from '../../bin/lib/json-schema.ts';
import { EXIT, PROTOCOL_VERSION } from '../../bin/site/types.ts';
import { fromRoot, read } from './helpers/desired-state.ts';

const schema = read<JsonSchema>('public/schemas/site-protocol-v1.json');

// One `site` invocation: the exit code and the single JSON document on stdout.
function site(...args: string[]): { code: number | null; document: Record<string, unknown> } {
  const run = spawnSync(process.execPath, [fromRoot('bin/site.ts'), ...args, '--json'], { cwd: fromRoot('.'), encoding: 'utf8' });
  return { code: run.status, document: JSON.parse(run.stdout) as Record<string, unknown> };
}

const problemsIn = (document: unknown): string[] => validate(schema, document);

describe('the protocol schema', () => {
  test('is published where its id says', () => {
    assert.equal(schema.$id, 'https://jseverino.com/schemas/site-protocol-v1.json');
    assert.equal(schema.$defs?.protocolVersion?.const, PROTOCOL_VERSION);
  });

  test('lists the exit codes the process uses', () => {
    assert.deepEqual(schema.$defs?.exitCode?.enum, Object.values(EXIT));
  });
});

describe('real documents', () => {
  test('--help is a valid document, and the schema names every command it lists', () => {
    const { code, document } = site('--help');
    assert.equal(code, EXIT.ok);
    assert.deepEqual(problemsIn(document), []);
    const listed = (document.commands as { name: string }[]).map((entry) => entry.name);
    assert.deepEqual(schema.$defs?.command?.enum, listed);
  });

  test('a command result is valid and carries the version', () => {
    const { code, document } = site('contract');
    assert.equal(code, EXIT.ok);
    assert.equal(document.protocolVersion, PROTOCOL_VERSION);
    assert.deepEqual(problemsIn(document), []);
  });

  test('a failure is valid, and its error code is the process exit code', () => {
    const { code, document } = site('nope');
    assert.equal(code, EXIT.usage);
    assert.deepEqual(problemsIn(document), []);
    assert.equal((document.error as { code: number }).code, code);
  });
});

describe('documents the schema refuses', () => {
  const success = { protocolVersion: 1, ok: true, command: 'status', status: 'ok', next: null };

  test('accepts the minimal envelope', () => {
    assert.deepEqual(problemsIn(success), []);
  });

  test('a different protocol version', () => {
    assert.notDeepEqual(problemsIn({ ...success, protocolVersion: 2 }), []);
  });

  test('a success with no status, or a command that does not exist', () => {
    const { status: _status, ...withoutStatus } = success;
    assert.notDeepEqual(problemsIn(withoutStatus), []);
    assert.notDeepEqual(problemsIn({ ...success, command: 'deploy' }), []);
  });

  test('a failure with an unknown exit code or no error', () => {
    const failure = { protocolVersion: 1, ok: false, command: 'publish', status: 'failed', error: { message: 'x', code: 1, fix: null } };
    assert.deepEqual(problemsIn(failure), []);
    assert.notDeepEqual(problemsIn({ ...failure, error: { ...failure.error, code: 9 } }), []);
    const { error: _error, ...withoutError } = failure;
    assert.notDeepEqual(problemsIn(withoutError), []);
  });
});

describe('the apply-plan input', () => {
  const plan = (value: unknown): string[] => validate({ $ref: '#/$defs/plan' }, value, schema);

  test('accepts updates, a complete featured order, and a fingerprint', () => {
    assert.deepEqual(plan({ updates: [{ slug: 'a', title: 'A' }], featured_order: ['a', 'b'], source_fingerprint: 'abc123' }), []);
    assert.deepEqual(plan({}), []);
  });

  test('refuses an update with no slug and a field it does not know', () => {
    assert.notDeepEqual(plan({ updates: [{ title: 'A' }] }), []);
    assert.notDeepEqual(plan({ featured: ['a'] }), []);
  });
});
