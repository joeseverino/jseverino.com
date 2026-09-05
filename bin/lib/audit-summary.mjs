// Terse one-line summary of an audit's output, per its registry `summary`
// kind. Shared by every gate that prints a status line per audit, so the same
// audit reads the same way in publish:check, gate:check, and the job summary.
export function summarize(audit, output) {
  if (audit.summary === 'silent') return 'passed';
  if (audit.summary === 'astro') {
    return /Result \([^)]+\):\s*\n- 0 errors\s*\n- 0 warnings/.test(output) ? '0 errors, 0 warnings' : 'passed';
  }
  if (audit.summary === 'assets') {
    const lines = output.split('\n').map((l) => l.trim()).filter(Boolean);
    return [
      lines.find((l) => l.startsWith('Images:')),
      lines.find((l) => l.startsWith('Total image weight:')),
      lines.find((l) => l.startsWith('No images over')),
    ].filter(Boolean).join('; ') || 'passed';
  }
  // Audits print their summary as an aligned `ok␣␣…` line (two+ spaces),
  // distinct from per-item `ok <detail>` lines.
  const ok = output.split('\n').find((l) => /^ok\s{2,}/.test(l));
  return ok ? ok.replace(/^ok\s+/, '').trim() : 'passed';
}

// First line that reads as the reason, for a failed audit's summary row.
export function firstFailureLine(output) {
  const lines = output.split('\n').map((l) => l.trim()).filter(Boolean);
  return (
    lines.find((l) => /^(error|failed|fail|✖|✗|-\s)/i.test(l)) ??
    lines.find((l) => !/^ok\b/.test(l)) ??
    lines.at(-1) ??
    'failed'
  );
}
