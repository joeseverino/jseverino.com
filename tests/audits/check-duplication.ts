#!/usr/bin/env node
// No copy-pasted code: a run of identical tokens that appears twice across the
// tracked TypeScript is a clone, and a clone fails the gate. The fix is one
// shared primitive both sites import. Tokens come from the TypeScript scanner,
// so formatting and comments never matter; import and re-export lines are
// skipped, since naming the same modules is not duplicated logic. Specs and
// unit tests may repeat a little more setup than the code they test.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { trackedFiles } from '../../bin/lib/git.ts';
import { siteRoot } from '../../src/lib/site-root.ts';

export const THRESHOLDS = {
  code: { tokens: 30, lines: 3 },
  tests: { tokens: 40, lines: 4 },
} as const;

const isTest = (file: string): boolean => /^tests\/(?:unit|playwright|edge)\//.test(file);
const MIN_TOKENS = THRESHOLDS.code.tokens;

// Generated projections and test data repeat by design; the generators that
// write them are checked like everything else.
const IGNORED = [/^src\/generated\//, /^functions\/generated\//, /^tests\/fixtures\/content\//, /\.d\.ts$/];

interface Token {
  text: string;
  line: number;
}

interface Clone {
  a: { file: string; start: number; end: number };
  b: { file: string; start: number; end: number };
  tokens: number;
}

const MODULE_LINE = /^\s*(?:import\b|export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\b)/;

export function tokenize(source: string): Token[] {
  const lines = source.split('\n');
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, source);
  const tokens: Token[] = [];
  let line = 1;
  let counted = 0;
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    const start = scanner.getTokenStart();
    for (; counted < start; counted += 1) if (source.charCodeAt(counted) === 10) line += 1;
    if (MODULE_LINE.test(lines[line - 1] ?? '')) continue;
    tokens.push({ text: scanner.getTokenText(), line });
  }
  return tokens;
}

// Rolling hashes over every MIN_TOKENS window; a repeated window grows into the
// longest run both sites share, and each pair of sites is reported once.
export function findClones(files: ReadonlyMap<string, Token[]>): Clone[] {
  const ids = new Map<string, number>();
  const id = (text: string): number => {
    let value = ids.get(text);
    if (value === undefined) ids.set(text, (value = ids.size + 1));
    return value;
  };
  const sequences = [...files].map(([file, tokens]) => ({ file, tokens, ids: tokens.map((token) => id(token.text)) }));
  const seen = new Map<string, { seq: number; at: number }>();
  const clones: Clone[] = [];
  const covered = new Set<string>();

  sequences.forEach((sequence, seq) => {
    for (let at = 0; at + MIN_TOKENS <= sequence.ids.length; at += 1) {
      const key = sequence.ids.slice(at, at + MIN_TOKENS).join(',');
      const first = seen.get(key);
      if (!first) {
        seen.set(key, { seq, at });
        continue;
      }
      if (first.seq === seq && at - first.at < MIN_TOKENS) continue;
      const pair = `${first.seq}:${first.at}:${seq}:${at}`;
      if (covered.has(pair)) continue;
      const other = sequences[first.seq];
      if (!other) continue;
      let length = MIN_TOKENS;
      while (
        at + length < sequence.ids.length &&
        first.at + length < other.ids.length &&
        sequence.ids[at + length] === other.ids[first.at + length] &&
        !(first.seq === seq && first.at + length >= at)
      ) length += 1;
      for (let step = 0; step < length; step += 1) covered.add(`${first.seq}:${first.at + step}:${seq}:${at + step}`);
      const span = (tokens: Token[], start: number) => ({ start: tokens[start]?.line ?? 0, end: tokens[start + length - 1]?.line ?? 0 });
      const a = { file: other.file, ...span(other.tokens, first.at) };
      const b = { file: sequence.file, ...span(sequence.tokens, at) };
      // A clone between two test files is held to the test threshold.
      const limit = isTest(a.file) && isTest(b.file) ? THRESHOLDS.tests : THRESHOLDS.code;
      const lines = Math.max(a.end - a.start, b.end - b.start) + 1;
      if (length >= limit.tokens && lines >= limit.lines) clones.push({ a, b, tokens: length });
    }
  });
  return clones;
}

if (import.meta.main) {
  const tracked = trackedFiles(siteRoot, '*.ts');
  const files = new Map<string, Token[]>();
  for (const file of tracked) {
    if (IGNORED.some((pattern) => pattern.test(file))) continue;
    const full = path.join(siteRoot, file);
    if (fs.existsSync(full)) files.set(file, tokenize(fs.readFileSync(full, 'utf8')));
  }
  const clones = findClones(files);
  if (clones.length > 0) {
    console.error(`duplicated code: ${clones.length} clone(s); extract one shared primitive for each:`);
    for (const { a, b, tokens } of clones) {
      console.error(`- ${a.file}:${a.start}-${a.end} = ${b.file}:${b.start}-${b.end} (${tokens} tokens)`);
    }
    process.exit(1);
  }
  const { code, tests } = THRESHOLDS;
  console.log(`ok       ${files.size} files, no clone of ${code.tokens}+ tokens over ${code.lines}+ lines (${tests.tokens}/${tests.lines} between tests)`);
}
