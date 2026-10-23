// public/_headers, read as data: the audits check the built file with it, and the Worker gives its
// own responses the headers the assets layer adds to every static one.

import { htmlPolicy, reportingEndpoints } from './csp.ts';
import { cspReportUri } from './site-config.ts';

// Path rules to header lines, in file order. A `!` line (a detach) is kept as written.
export function parseHeaders(text: string): Map<string, string[]> {
  const rules = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (/^\s/.test(line)) current?.push(line.trim());
    else {
      current = rules.get(line.trim()) ?? [];
      rules.set(line.trim(), current);
    }
  }
  return rules;
}

const DETACH = /^!\s*/;

// Matching rules' lines applied as Cloudflare's asset worker applies them, rule by rule in file
// order: a rule's `!` lines remove the header the rules before it set, then its other lines set
// theirs, a repeated header joining with a comma. Names are lower-cased.
export function applyRules(rules: Iterable<readonly string[]>): Map<string, string> {
  const headers = new Map<string, string>();
  for (const lines of rules) {
    for (const line of lines) if (DETACH.test(line)) headers.delete(line.replace(DETACH, '').trim().toLowerCase());
    for (const line of lines) {
      if (DETACH.test(line)) continue;
      const colon = line.indexOf(':');
      const name = line.slice(0, colon).trim().toLowerCase();
      const value = line.slice(colon + 1).trim();
      const before = headers.get(name);
      headers.set(name, before === undefined ? value : `${before}, ${value}`);
    }
  }
  return headers;
}

// The `/*` rule as headers for a response the Worker builds. _headers applies only to static
// assets, so the API and the preview proxy set these themselves. Their bodies carry no inline
// tags, so the policy has no hashes.
export function workerHeaders(text: string): Headers {
  const values: Record<string, string> = {
    __CSP__: htmlPolicy({ scriptHashes: [], styleHashes: [], reportUri: cspReportUri, trustedTypes: true }),
    __REPORTING_ENDPOINTS__: reportingEndpoints(cspReportUri),
  };
  const headers = new Headers();
  for (const [name, value] of applyRules([parseHeaders(text).get('/*') ?? []])) headers.set(name, values[value] ?? value);
  return headers;
}
