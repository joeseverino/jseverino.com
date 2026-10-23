import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { type JsonSchema, validate } from '../../bin/lib/json-schema.ts';
import { SiteError } from '../../bin/site/cli.ts';
import { EXIT, PROTOCOL_VERSION } from '../../bin/site/types.ts';
import { failureDocument, successDocument } from '../../bin/site.ts';
import { fromRoot } from '../../src/lib/site-root.ts';
import { read } from './helpers/desired-state.ts';
import { scratchDirs, write } from './helpers/fs.ts';

const schema = read<JsonSchema>('public/schemas/site-protocol-v1.json');

const scratch = scratchDirs('site-protocol-');
after(scratch.cleanup);

// One `site` invocation: the exit code and the single JSON document on stdout.
function site(args: string[], env: NodeJS.ProcessEnv = {}): { code: number | null; document: Record<string, unknown> } {
  const run = spawnSync(process.execPath, [fromRoot('bin/site.ts'), ...args, '--json'], {
    cwd: fromRoot('.'),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
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
    const { code, document } = site(['--help']);
    assert.equal(code, EXIT.ok);
    assert.deepEqual(problemsIn(document), []);
    const listed = (document.commands as { name: string }[]).map((entry) => entry.name);
    assert.deepEqual(schema.$defs?.command?.enum, listed);
  });

  test('a command result is valid and carries the version', () => {
    const { code, document } = site(['contract']);
    assert.equal(code, EXIT.ok);
    assert.equal(document.protocolVersion, PROTOCOL_VERSION);
    assert.deepEqual(problemsIn(document), []);
  });

  test("a write's receipt is valid, and the schema holds it to the receipt shape", () => {
    const vault = path.join(scratch.make(), 'vault');
    write(path.join(vault, '05 Writeups/alpha/index.md'), '---\ntitle: Alpha\npublished: false\n---\nBody\n');
    const { code, document } = site(['set', 'alpha', '--title', 'Alpha, retitled'], { VAULT_DIR: vault });
    assert.equal(code, EXIT.ok);
    assert.deepEqual(problemsIn(document), []);
    const receipt = document.receipt as Record<string, unknown>;
    assert.deepEqual(receipt.changed_fields, ['title']);
    assert.notDeepEqual(problemsIn({ ...document, receipt: { ...receipt, receipt_version: 2 } }), []);
    const { receipt: _receipt, ...unreceipted } = document;
    assert.notDeepEqual(problemsIn({ ...unreceipted, command: 'link' }), [], 'a link always writes, so it always carries a receipt');
  });

  test('a failure is valid, and its error code is the process exit code', () => {
    const { code, document } = site(['nope']);
    assert.equal(code, EXIT.usage);
    assert.deepEqual(problemsIn(document), []);
    assert.equal((document.error as { code: number }).code, code);
  });
});

describe('the envelope', () => {
  test('a result field never replaces ok, command, or status', () => {
    const result = { ok: false, command: 'other', httpStatus: 503, next: null } as unknown as Parameters<typeof successDocument<'headers'>>[1];
    const document = successDocument('headers', result);
    assert.equal(document.ok, true);
    assert.equal(document.command, 'headers');
    assert.equal(document.status, 'ok');
  });

  test("a command's own status is kept", () => {
    const result = { status: 'landed', next: null } as unknown as Parameters<typeof successDocument<'land'>>[1];
    assert.equal(successDocument('land', result).status, 'landed');
  });

  test("a failure's partial result never replaces ok, status, or error", () => {
    const error = new SiteError('boom', { code: EXIT.usage, result: { ok: true, status: 'landed', error: null, pr: 'u' } });
    const document = failureDocument('land', error);
    assert.equal(document.ok, false);
    assert.equal(document.status, 'failed');
    assert.equal(document.error.code, EXIT.usage);
    assert.equal(document.pr, 'u');
    assert.deepEqual(problemsIn({ protocolVersion: PROTOCOL_VERSION, ...document }), []);
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
  const plan = (value: unknown): string[] => validate({ $defs: schema.$defs, $ref: '#/$defs/plan' }, value);

  test('accepts updates, a complete featured order, and a fingerprint', () => {
    assert.deepEqual(plan({ updates: [{ slug: 'a', title: 'A' }], featured_order: ['a', 'b'], source_fingerprint: 'abc123' }), []);
    assert.deepEqual(plan({}), []);
  });

  test('refuses an update with no slug and a field it does not know', () => {
    assert.notDeepEqual(plan({ updates: [{ title: 'A' }] }), []);
    assert.notDeepEqual(plan({ featured: ['a'] }), []);
  });
});
