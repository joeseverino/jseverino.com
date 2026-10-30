// Every module under src that writes D1 is imported, beside tests/unit/helpers/d1-sqlite.ts, by one unit spec.
// d1-sqlite.ts loads cloudflare/d1.sql into node:sqlite, which rejects an unknown table or column and a value
// count that differs from the column list. A write is an INSERT, UPDATE or DELETE literal passed to prepare() or
// exec(); TypeScript parses each file, so a comment or any other string never counts.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { fromRoot } from '../../src/lib/site-root.ts';
import { finish } from './lib.ts';

const WRITE = /\b(?:INSERT\s+INTO|DELETE\s+FROM|UPDATE\s+\w+\s+SET)\b/i;
const HELPER = fromRoot('tests/unit/helpers/d1-sqlite.ts');

const files = (pattern: string): string[] => fs.globSync(pattern, { cwd: fromRoot() }).map((file) => fromRoot(file));
const read = (file: string): string => fs.readFileSync(file, 'utf8');

function sqlOf(node: ts.Node): string | undefined {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return undefined;
  if (!['prepare', 'exec'].includes(node.expression.name.text)) return undefined;
  const [sql] = node.arguments;
  if (sql && ts.isStringLiteralLike(sql)) return sql.text;
  return sql && ts.isTemplateExpression(sql) ? sql.head.text : undefined;
}

const writesD1 = (node: ts.Node): boolean => WRITE.test(sqlOf(node) ?? '') || Boolean(ts.forEachChild(node, writesD1));

// Each import, export-from and dynamic import, resolved from the spec's directory.
const importsOf = (spec: string): Set<string> =>
  new Set(ts.preProcessFile(read(spec)).importedFiles.map(({ fileName }) => path.resolve(path.dirname(spec), fileName)));

const writers = files('src/**/*.ts').filter((file) => writesD1(ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest)));
const sqliteSpecs = files('tests/unit/**/*.test.ts')
  .map(importsOf)
  .filter((imports) => imports.has(HELPER));

const problems = writers
  .filter((file) => !sqliteSpecs.some((imports) => imports.has(file)))
  .map((file) => `${path.relative(fromRoot(), file)} writes D1, and no spec imports it beside tests/unit/helpers/d1-sqlite.ts`);
if (writers.length === 0) problems.push('no D1 write under src; the handlers moved, so this audit reads the wrong place');

finish(problems, `${writers.length} D1 writers, each run against cloudflare/d1.sql in a unit spec`, {
  heading: 'check-d1-writes: D1 writes no spec runs against the schema:',
  fix: 'fix: add a spec that imports the module and runs it against createD1Sqlite() from tests/unit/helpers/d1-sqlite.ts',
});
