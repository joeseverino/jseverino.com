#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { siteRoot as root } from '../../src/lib/site-root.ts';
import { walkFiles } from '../../src/lib/walk.ts';
import { finish } from './lib.ts';

const roots = ['bin', 'src', 'tests'];
const failures: string[] = [];

function inspect(file: string): void {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  // parseDiagnostics is internal to the compiler API: the syntax errors alone,
  // without a type-checking program.
  const { parseDiagnostics } = source as ts.SourceFile & { parseDiagnostics: readonly ts.DiagnosticWithLocation[] };
  for (const diagnostic of parseDiagnostics) {
    const point = source.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    failures.push(`${path.relative(root, file)}:${point.line + 1}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`);
  }
  const declarations = new Map<string, number>();
  for (const statement of source.statements) {
    if (!ts.isFunctionDeclaration(statement) || !statement.name) continue;
    const name = statement.name.text;
    const previous = declarations.get(name);
    if (previous) {
      const point = source.getLineAndCharacterOfPosition(statement.name.getStart(source));
      failures.push(`${path.relative(root, file)}:${point.line + 1}: duplicate top-level function ${name} (first declared line ${previous})`);
    } else {
      declarations.set(name, source.getLineAndCharacterOfPosition(statement.name.getStart(source)).line + 1);
    }
  }
}

for (const directory of roots) {
  for (const file of walkFiles(path.join(root, directory), { filter: (file) => /\.(?:mjs|cjs|js|ts)$/.test(file) })) {
    inspect(file);
  }
}
finish(failures, 'source files parse and top-level function declarations are unique', { bullet: '' });
