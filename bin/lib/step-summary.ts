// Job-summary and log helpers for the bin/ runners. Inert outside GitHub Actions.
import fs from 'node:fs';

export const inActions = process.env.GITHUB_ACTIONS === 'true';

export function annotate(kind: 'error' | 'warning' | 'notice', title: string, message: string): void {
  if (inActions) console.log(`::${kind} title=${title}::${message}`);
}

export function group(title: string): void {
  if (inActions) console.log(`::group::${title}`);
}

export function endGroup(): void {
  if (inActions) console.log('::endgroup::');
}

// Backslashes first, then pipes, then newlines: a cell must not be able to
// escape its own table row.
export function cell(text: unknown): string {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
}

// ok is true, false, or null (skipped).
export type Outcome = boolean | null;

export function outcome(ok: Outcome): string {
  if (ok === true) return 'pass';
  if (ok === false) return '**FAIL**';
  return 'skipped';
}

export function table(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return [
    `| ${headers.map(cell).join(' | ')} |`,
    `| ${headers.map(() => ':---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
  ].join('\n');
}

// Returns false outside Actions. JOB_SUMMARY_FILE gets a second copy because the step summary file
// is private to its step and a later job (the PR comment) needs one it can upload.
export function appendSummary(markdown: string): boolean {
  const targets = [process.env.GITHUB_STEP_SUMMARY, process.env.JOB_SUMMARY_FILE].filter((file): file is string => Boolean(file));
  if (targets.length === 0) return false;
  for (const file of targets) fs.appendFileSync(file, `${markdown}\n\n`);
  return true;
}

// Rows for one gate's job-summary table: add() each step, write() once at the end.
interface ReportRow {
  label: string;
  ok: Outcome;
  detail: string;
}

export function createReport(title: string, column = 'Step') {
  const rows: ReportRow[] = [];
  return {
    rows,
    add(label: string, ok: Outcome, detail: string): void {
      rows.push({ label, ok, detail });
    },
    failed: () => rows.filter((row) => row.ok === false),
    write(intro: string): boolean {
      return appendSummary([
        `## ${title}`,
        '',
        intro,
        '',
        table([column, 'Result', 'Detail'], rows.map((row) => [`\`${row.label}\``, outcome(row.ok), row.detail])),
      ].join('\n'));
    },
  };
}
