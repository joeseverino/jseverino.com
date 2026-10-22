// public/_headers, read as data: the audits check the built file with it, and the Worker gives its
// own responses the headers the assets layer adds to every static one.
import { cspReportUri } from './site-config.ts';
import { htmlPolicy, reportingEndpoints } from './csp.ts';

// Path rules to header lines, in file order. A `!` line (a detach) is kept as written.
export function parseHeaders(text: string): Map<string, string[]> {
  const rules = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (/^\s/.test(line)) current?.push(line.trim());
    else rules.set(line.trim(), (current = rules.get(line.trim()) ?? []));
  }
  return rules;
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
  for (const line of parseHeaders(text).get('/*') ?? []) {
    if (line.startsWith('!')) continue;
    const colon = line.indexOf(':');
    const value = line.slice(colon + 1).trim();
    headers.set(line.slice(0, colon).trim(), values[value] ?? value);
  }
  return headers;
}
