import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ToolOptions } from '../../../bin/lib/drift.ts';
import { type JsonSchema, validate } from '../../../bin/lib/json-schema.ts';
import { readJson } from '../../../src/lib/json.ts';
import { fromRoot } from '../../../src/lib/site-root.ts';

export const read = <T>(file: string): T => readJson<T>(fromRoot(file));

// A request one of the API fakes received.
interface RecordedCall {
  method: string;
  path: string;
  body: unknown;
  authorization: string | null;
}

// The request log of an API fake. `record` reads a request, refusing any other host, and
// logs it; its `path` is relative to the API base and carries no query, the logged one does.
export function callRecorder(apiBase: string, token: string) {
  const calls: RecordedCall[] = [];
  function record(input: RequestInfo | URL, init: RequestInit) {
    const href = input instanceof Request ? input.url : String(input);
    const url = new URL(href);
    if (!href.startsWith(apiBase)) throw new Error(`unexpected host: ${url.origin}`);
    const path = url.pathname.slice(new URL(apiBase).pathname.replace(/\/$/, '').length);
    const method = init.method ?? 'GET';
    const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const authorization = new Headers(init.headers).get('authorization');
    calls.push({ method, path: `${path}${url.search}`, body, authorization });
    return { url, path, method, body, authorized: authorization === `Bearer ${token}` };
  }
  const writes = () => calls.filter((call) => call.method !== 'GET');
  return { calls, record, writes };
}

interface Fake {
  calls: readonly RecordedCall[];
  writes: () => readonly RecordedCall[];
}

export function runner<F extends Fake, Extra extends ToolOptions>(main: (options: ToolOptions & Extra) => Promise<number>, extra: (fake: F) => Extra) {
  async function run(fake: F, ...argv: string[]) {
    const lines: string[] = [];
    const code = await main({ argv, write: (line: string) => lines.push(line), ...extra(fake) });
    return { code, output: lines.join('\n') };
  }
  async function checkJson(fake: F) {
    const { code, output } = await run(fake, 'check', '--json');
    return { code, report: JSON.parse(output) };
  }
  // The token goes only in the bearer header and never into the output, which is returned.
  async function bearerOnly(fake: F, token: string) {
    const { output } = await run(fake, 'check');
    assert.ok(fake.calls.every((call) => call.authorization === `Bearer ${token}`));
    assert.ok(!output.includes(token));
    return output;
  }
  async function missingTokenStops(fake: F, variable: RegExp) {
    await assert.rejects(main({ argv: ['check'], write: () => {}, ...extra(fake), env: {} }), variable);
    assert.equal(fake.calls.length, 0);
  }
  // `plan --json` as `METHOD path` lines; a plan writes nothing.
  async function planLines(fake: F) {
    const { code, output } = await run(fake, 'plan', '--json');
    assert.equal(code, 0);
    assert.equal(fake.writes().length, 0);
    return (JSON.parse(output) as { calls: RecordedCall[] }).calls.map((call) => `${call.method} ${call.path}`);
  }
  async function applyWithoutYesIsAPlan(fake: F) {
    const { code, output } = await run(fake, 'apply');
    assert.equal(code, 0);
    assert.match(output, /re-run with --yes/);
    assert.equal(fake.writes().length, 0);
  }
  async function reapplyIsNoOp(fake: F) {
    const before = fake.writes().length;
    const second = await run(fake, 'apply', '--yes');
    assert.match(second.output, /no API calls needed/);
    assert.equal(fake.writes().length, before, 'a second apply makes no writes');
  }
  return { run, checkJson, bearerOnly, missingTokenStops, planLines, applyWithoutYesIsAPlan, reapplyIsNoOp };
}

// A field added to the type and not the schema (or the reverse) fails here.
export function schemaTests({
  desired,
  schema,
  load,
  fields,
}: {
  desired: unknown;
  schema: JsonSchema;
  load: () => unknown;
  fields: Record<string, true>;
}): void {
  test('matches its schema', () => {
    assert.deepEqual(validate(schema, desired), []);
    assert.doesNotThrow(load);
  });

  test("the DesiredState type names exactly the schema's properties", () => {
    assert.deepEqual(Object.keys(fields).sort(), Object.keys(schema.properties ?? {}).sort());
  });
}
