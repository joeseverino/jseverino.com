// Every handler that writes D1 runs its statements against the real schema in a unit spec:
// tests/unit/helpers/d1-sqlite.ts loads cloudflare/d1.sql into node:sqlite, which rejects an
// unknown table or column and a value count that differs from the column list.
import fs from 'node:fs';
import { fromRoot } from '../../src/lib/site-root.ts';
import { finish } from './lib.ts';

const read = (file: string): string => fs.readFileSync(fromRoot(file), 'utf8');
const WRITE = /\b(?:INSERT INTO|DELETE FROM|UPDATE\s+\w+\s+SET)\b/;

const writers = fs.globSync('src/lib/api/*.ts', { cwd: fromRoot() }).filter((file) => WRITE.test(read(file)));
const sqliteSpecs = fs
  .globSync('tests/unit/**/*.test.ts', { cwd: fromRoot() })
  .map(read)
  .filter((spec) => spec.includes("from './helpers/d1-sqlite.ts'"));

const problems = writers
  .filter((file) => !sqliteSpecs.some((spec) => spec.includes(`from '../../${file}'`)))
  .map((file) => `${file} writes D1, and no spec that imports it runs against tests/unit/helpers/d1-sqlite.ts`);
if (writers.length === 0) problems.push('no D1 write under src/lib/api; the handlers moved, so this audit reads the wrong place');

finish(problems, `${writers.length} D1 writers, each run against cloudflare/d1.sql in a unit spec`, {
  heading: 'check-d1-writes: D1 writes no spec runs against the schema:',
  fix: 'fix: add a spec that runs the handler against createD1Sqlite() from tests/unit/helpers/d1-sqlite.ts',
});
