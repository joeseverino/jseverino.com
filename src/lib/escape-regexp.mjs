// Escape every regular-expression metacharacter in a string so it can be safely
// interpolated into a `new RegExp(...)` pattern as a literal. Single source, so
// call sites never hand-roll a partial escape (e.g. dots only) — which is both a
// correctness bug on inputs containing metacharacters and what CodeQL flags as
// js/incomplete-sanitization.
export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
