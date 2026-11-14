import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnResult } from '../../../bin/lib/run.ts';
import { siteRoot } from '../../../src/lib/site-root.ts';
import { tempDir, write } from './fs.ts';

// Biome's rdjson report (reviewdog's diagnostic format).
interface Report {
  diagnostics: { code: { value: string }; location: { range: { start: { line: number; column: number }; end: { line: number; column: number } } } }[];
}

interface Finding {
  // `plugin` for a GritQL plugin, else the lint rule's name.
  rule: string;
  // The flagged line, trimmed.
  line: string;
  // The source text the finding spans, when it starts and ends on one line.
  text: string;
}

// The pinned Biome over one fixture file, under a scratch config that loads
// only the named tests/<name>.grit plugins, so a plugin is held to the syntax
// tree of the Biome release that runs it. `config` adds to the scratch config.
export function biomeFindings(plugins: string[], file: string, source: string, config: Record<string, unknown> = {}): Finding[] {
  const dir = tempDir('biome-');
  try {
    return lint(dir, plugins, file, source, config);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function lint(dir: string, plugins: string[], file: string, source: string, config: Record<string, unknown>): Finding[] {
  write(
    path.join(dir, 'biome.json'),
    JSON.stringify({
      root: true,
      plugins: plugins.map((name) => path.join(siteRoot, `tests/${name}.grit`)),
      linter: { rules: { preset: 'none' } },
      ...config,
    }),
  );
  write(path.join(dir, file), source);
  // From the checkout, where mise resolves the pinned Biome; the config is the scratch one.
  const result = spawnResult('biome', ['lint', `--config-path=${dir}`, '--reporter=rdjson', path.join(dir, file)], { cwd: siteRoot });
  assert.equal(result.error, undefined, result.error);
  const lines = source.split('\n');
  const { diagnostics } = JSON.parse(result.stdout) as Report;
  return diagnostics.map(({ code, location: { range } }) => {
    const line = lines[range.start.line - 1] ?? '';
    const text = range.start.line === range.end.line ? line.slice(range.start.column - 1, range.end.column - 1) : '';
    return { rule: code.value, line: line.trim(), text };
  });
}
