import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { readJson, writeJson } from '../../src/lib/json.ts';
import { scratchDirs } from './helpers/fs.ts';

const scratch = scratchDirs('json-');
after(scratch.cleanup);

test('writeJson creates the directory, ends the file in a newline, and round-trips through readJson', () => {
  const file = path.join(scratch.make(), 'nested', 'out.json');
  writeJson(file, { count: 2 });
  assert.ok(fs.readFileSync(file, 'utf8').endsWith('}\n'));
  assert.deepEqual(readJson(file), { count: 2 });
});
