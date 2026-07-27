#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const roots = ['bin', 'src', 'tests'];
const failures = [];

function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(absolute);
    else if (/\.(?:mjs|cjs|js|ts)$/.test(entry.name)) inspect(absolute);
  }
}

function inspect(file) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  for (const diagnostic of source.parseDiagnostics) {
    const point = source.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    failures.push(`${path.relative(root, file)}:${point.line + 1}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`);
  }
  const declarations = new Map();
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

for (const directory of roots) visit(path.join(root, directory));
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('ok       source files parse and top-level function declarations are unique');
