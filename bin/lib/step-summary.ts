// Log, job-summary and annotation helpers for the bin/ runners. Everything but status() is inert outside GitHub Actions.
import fs from 'node:fs';

const inActions = process.env.GITHUB_ACTIONS === 'true';

// The workflow-command escaping @actions/core applies, so text cannot end the command or start another.
const escapeData = (text: string): string => text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProperty = (text: string): string => escapeData(text).replace(/:/g, '%3A').replace(/,/g, '%2C');

export const annotation = (kind: 'error' | 'warning' | 'notice', title: string, message: string): string =>
  `::${kind} title=${escapeProperty(title)}::${escapeData(message)}`;

export function annotate(kind: 'error' | 'warning' | 'notice', title: string, message: string): void {
  if (inActions) console.log(annotation(kind, title, message));
}

// One aligned log line per step, in and out of Actions.
export function status(label: string, detail: string): void {
  console.log(`${label.padEnd(12)} ${detail}`);
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
  return String(text).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

// ok is true, false, or null (skipped).
type Outcome = boolean | null;

function outcome(ok: Outcome): string {
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
      return appendSummary(
        [
          `## ${title}`,
          '',
          intro,
          '',
          table(
            [column, 'Result', 'Detail'],
            rows.map((row) => [`\`${row.label}\``, outcome(row.ok), row.detail]),
          ),
        ].join('\n'),
      );
    },
  };
}
