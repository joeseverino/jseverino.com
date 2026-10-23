import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import { fromRoot } from '../../src/lib/site-root.ts';

// Biome's import sort treats a comment after a shebang as attached to the next
// import unless blank lines detach it, and then moves it with that import.
test("each script's header comment is detached from the shebang and the code below it", () => {
  const scripts = fs.globSync('bin/*.ts', { cwd: fromRoot() });
  assert.ok(scripts.length > 0);
  for (const script of scripts) {
    const lines = fs.readFileSync(fromRoot(script), 'utf8').split('\n');
    if (!lines[0]?.startsWith('#!')) continue;
    assert.equal(lines[1], '', `${script}: a blank line after the shebang`);
    assert.match(lines[2] ?? '', /^\/\/ /, `${script}: a header comment`);
    const end = lines.findIndex((line, index) => index > 2 && !line.startsWith('//'));
    assert.equal(lines[end], '', `${script}: a blank line after the header`);
  }
});
