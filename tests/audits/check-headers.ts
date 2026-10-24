// The built _headers is complete: no placeholder left, no path listed twice, the policy on
// every route and the contact page's own. Which paths start the Worker is wrangler.jsonc's
// `run_worker_first`; the edge suite proves both under the local runtime.

import fs from 'node:fs';
import path from 'node:path';
import { PLACEHOLDERS } from '../../bin/build-csp.ts';
import { parseHeaders } from '../../src/lib/headers-file.ts';
import { builtPages, finish } from './lib.ts';

const { distDir } = builtPages('check-headers');
const headersFile = path.join(distDir, '_headers');
const headersText = fs.existsSync(headersFile) ? fs.readFileSync(headersFile, 'utf8') : '';
const headers = parseHeaders(headersText);

const problems: string[] = [];
const listed = headersText.split('\n').filter((line) => /^[^\s#]/.test(line));
for (const rule of new Set(listed.filter((line, i) => listed.indexOf(line) !== i))) {
  problems.push(`_headers lists ${rule} more than once; only the last block applies`);
}
const left = PLACEHOLDERS.filter((placeholder) => headersText.includes(placeholder));
if (left.length > 0) problems.push(`the built _headers still carries ${left.join(', ')}; bin/build-csp.ts did not run`);
const policy = (rule: string, prefix: string) => (headers.get(rule) ?? []).some((line) => line.startsWith(prefix));
if (!policy('/*', 'Content-Security-Policy: ')) problems.push('_headers sets no Content-Security-Policy on /*');
if (
  !policy('/contact/*', '! Content-Security-Policy') ||
  !policy('/contact/*', 'Content-Security-Policy: ') ||
  !policy('/contact/*', 'Content-Security-Policy-Report-Only: ')
) {
  problems.push('_headers does not give /contact/* its own policy (detach the global one, then set an enforced and a report-only line)');
}

finish(problems, `_headers carries the policy on /* and its own on /contact/*, with ${headers.size} rules each listed once`, {
  heading: 'check-headers: the built _headers is wrong for this build:',
  fix: 'fix: rebuild so bin/build-csp.ts fills the _headers placeholders, and list each path rule in public/_headers once',
});
