import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { jsonText, readJson, writeJson } from '../../src/lib/json.ts';
import { scratchDirs } from './helpers/fs.ts';

const scratch = scratchDirs('json-');
after(scratch.cleanup);

test('jsonText indents two spaces and ends with a newline', () => {
  assert.equal(jsonText({ a: [1] }), '{\n  "a": [\n    1\n  ]\n}\n');
});

test('writeJson creates the directory and round-trips through readJson', () => {
  const file = path.join(scratch.make(), 'nested', 'out.json');
  writeJson(file, { count: 2 });
  assert.equal(fs.readFileSync(file, 'utf8'), jsonText({ count: 2 }));
  assert.deepEqual(readJson(file), { count: 2 });
});
