// What the desired-state tool suites share (cloudflare.test.ts, github.test.ts):
// reading a committed file as the type it is committed as, running a tool's
// main() against a fake API with the output captured, and the two tests every
// desired-state file gets against its schema.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { validate, type JsonSchema } from '../../../bin/lib/json-schema.ts';
import type { ToolOptions } from '../../../bin/lib/drift.ts';
import { siteRoot } from '../../../src/lib/site-root.ts';
import { readJson } from '../../../src/lib/json.ts';

export const read = <T>(file: string): T => readJson<T>(path.join(siteRoot, file));
export const fromRoot = (file: string): string => path.join(siteRoot, file);

// `extra` is what a tool's main() takes besides the arguments: the token, the
// fake's fetch, and so on.
export function runner<Fake, Extra>(main: (options: ToolOptions & Extra) => Promise<number>, extra: (fake: Fake) => Extra) {
  async function run(fake: Fake, ...argv: string[]) {
    const lines: string[] = [];
    const code = await main({ argv, write: (line: string) => lines.push(line), ...extra(fake) });
    return { code, output: lines.join('\n') };
  }
  async function checkJson(fake: Fake) {
    const { code, output } = await run(fake, 'check', '--json');
    return { code, report: JSON.parse(output) };
  }
  return { run, checkJson };
}

// `fields` names every top-level field of the desired-state type, so a field
// added to the type and not the schema (or the reverse) fails here.
export function schemaTests({ desired, schema, load, fields }: { desired: unknown; schema: JsonSchema; load: () => unknown; fields: Record<string, true> }): void {
  test('matches its schema', () => {
    assert.deepEqual(validate(schema, desired), []);
    assert.doesNotThrow(load);
  });

  test('the DesiredState type names exactly the schema\'s properties', () => {
    assert.deepEqual(Object.keys(fields).sort(), Object.keys(schema.properties ?? {}).sort());
  });
}
