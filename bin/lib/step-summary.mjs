// Job-summary and log helpers for the bin/ runners when they execute inside
// GitHub Actions: a markdown table on the run page, collapsible log groups,
// and error annotations. Every function is inert anywhere else, so a local
// run prints exactly what it printed before.
import fs from 'node:fs';

export const inActions = process.env.GITHUB_ACTIONS === 'true';

export function annotate(kind, title, message) {
  if (inActions) console.log(`::${kind} title=${title}::${message}`);
}

export function group(title) {
  if (inActions) console.log(`::group::${title}`);
}

export function endGroup() {
  if (inActions) console.log('::endgroup::');
}

// Backslashes first, then pipes, then newlines: a cell must not be able to
// escape its own table row.
export function cell(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
}

export function outcome(ok) {
  if (ok === true) return 'pass';
  if (ok === false) return '**FAIL**';
  return 'skipped';
}

export function table(headers, rows) {
  return [
    `| ${headers.map(cell).join(' | ')} |`,
    `| ${headers.map(() => ':---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
  ].join('\n');
}

// Returns false outside Actions so callers can skip work that only feeds the
// summary.
export function appendSummary(markdown) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return false;
  fs.appendFileSync(file, `${markdown}\n\n`);
  return true;
}
