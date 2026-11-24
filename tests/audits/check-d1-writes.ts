// Every module under src that writes D1 is imported, beside tests/unit/helpers/d1-sqlite.ts, by one unit spec.
// d1-sqlite.ts loads cloudflare/d1.sql into node:sqlite, which rejects an unknown table or column and a value
// count that differs from the column list. A write is an INSERT, UPDATE or DELETE literal passed to prepare() or
// exec(); oxc parses each file, so a comment or any other string never counts.
import fs from 'node:fs';
import path from 'node:path';
import { type CallExpression, type Expression, parseSync, Visitor } from 'oxc-parser';
import { fromRoot } from '../../src/lib/site-root.ts';
import { finish } from './lib.ts';

const WRITE = /\b(?:INSERT\s+INTO|DELETE\s+FROM|UPDATE\s+\w+\s+SET)\b/i;
const HELPER = fromRoot('tests/unit/helpers/d1-sqlite.ts');

const files = (pattern: string): string[] => fs.globSync(pattern, { cwd: fromRoot() }).map((file) => fromRoot(file));

function scan(file: string): { imports: Set<string>; writes: boolean } {
  const scanned = { imports: new Set<string>(), writes: false };
  const add = ({ source }: { source: Expression | null }): void => {
    if (source?.type === 'Literal' && typeof source.value === 'string') scanned.imports.add(path.resolve(path.dirname(file), source.value));
  };
  const call = ({ callee, arguments: [sql] }: CallExpression): void => {
    if (callee.type !== 'MemberExpression' || callee.computed || !['prepare', 'exec'].includes(callee.property.name)) return;
    const text = sql?.type === 'TemplateLiteral' ? sql.quasis[0]?.value.cooked : sql?.type === 'Literal' ? sql.value : undefined;
    scanned.writes ||= typeof text === 'string' && WRITE.test(text);
  };
  const visitor = { ImportDeclaration: add, ExportNamedDeclaration: add, ExportAllDeclaration: add, ImportExpression: add, CallExpression: call };
  new Visitor(visitor).visit(parseSync(file, fs.readFileSync(file, 'utf8')).program);
  return scanned;
}

const writers = files('src/**/*.ts').filter((file) => scan(file).writes);
const sqliteSpecs = files('tests/unit/**/*.test.ts')
  .map((spec) => scan(spec).imports)
  .filter((imports) => imports.has(HELPER));

const problems = writers
  .filter((file) => !sqliteSpecs.some((imports) => imports.has(file)))
  .map((file) => `${path.relative(fromRoot(), file)} writes D1, and no spec imports it beside tests/unit/helpers/d1-sqlite.ts`);
if (writers.length === 0) problems.push('no D1 write under src; the handlers moved, so this audit reads the wrong place');

finish(problems, `${writers.length} D1 writers, each run against cloudflare/d1.sql in a unit spec`, {
  heading: 'check-d1-writes: D1 writes no spec runs against the schema:',
  fix: 'fix: add a spec that imports the module and runs it against createD1Sqlite() from tests/unit/helpers/d1-sqlite.ts',
});
