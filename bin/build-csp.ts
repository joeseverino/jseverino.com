// Hash each page's inline script and stylesheet, fail on any the policy would not
// cover, and write the CSP into the built _headers. The build runs it once; a preview
// deploy runs it again on the same build after the sitedrift wrap.
import fs from 'node:fs';
import path from 'node:path';
import { htmlPolicy, reportingEndpoints, scanInline, trustedTypesReportOnly } from '../src/lib/csp.ts';
import { cspReportUri } from '../src/lib/site-config.ts';

// Cloudflare ignores a _headers line past this length.
const MAX_HEADER_LINE = 2000;
const MAX_HASHES = 4;

export const PLACEHOLDERS = ['__CSP__', '__CSP_CONTACT__', '__TT_REPORT_ONLY__', '__REPORTING_ENDPOINTS__'] as const;

// templateFile keeps the _headers this fills, outside the served tree, so a later run on the
// same build (the preview wrap) fills the same template again.
export async function buildCsp(distDir: string, templateFile: string): Promise<{ pages: number; scriptHashes: string[]; styleHashes: string[] }> {
  const headersFile = path.join(distDir, '_headers');
  const current = fs.readFileSync(headersFile, 'utf8');
  // A _headers that still has a placeholder is fresh from the build; a filled one was filled from the template.
  if (PLACEHOLDERS.some((placeholder) => current.includes(placeholder)) || !fs.existsSync(templateFile)) {
    fs.writeFileSync(templateFile, current);
  }
  const template = fs.readFileSync(templateFile, 'utf8');

  const files = fs.readdirSync(distDir, { recursive: true, encoding: 'utf8' }).filter((file) => file.endsWith('.html'));
  const scans = await Promise.all(files.map(async (file) => ({ file, scan: await scanInline(fs.readFileSync(path.join(distDir, file), 'utf8')) })));

  const problems = scans.flatMap(({ file, scan }) => scan.problems.map((problem) => `${file}: ${problem}`));
  if (problems.length > 0) {
    throw new Error(`markup the Content Security Policy would block:\n  ${problems.join('\n  ')}`);
  }

  const scriptHashes = [...new Set(scans.flatMap(({ scan }) => scan.scriptHashes))];
  const styleHashes = [...new Set(scans.flatMap(({ scan }) => scan.styleHashes))];
  if (scriptHashes.length > MAX_HASHES || styleHashes.length > MAX_HASHES) {
    throw new Error(`${scriptHashes.length} inline script and ${styleHashes.length} inline style hashes; expected at most ${MAX_HASHES} of each`);
  }

  const input = { scriptHashes, styleHashes, reportUri: cspReportUri };
  const values: Record<(typeof PLACEHOLDERS)[number], string> = {
    __CSP__: htmlPolicy({ ...input, trustedTypes: true }),
    __CSP_CONTACT__: htmlPolicy({ ...input, trustedTypes: false }),
    __TT_REPORT_ONLY__: trustedTypesReportOnly(cspReportUri),
    __REPORTING_ENDPOINTS__: reportingEndpoints(cspReportUri),
  };

  let headers = template;
  for (const placeholder of PLACEHOLDERS) {
    if (!headers.includes(placeholder)) throw new Error(`_headers has no ${placeholder} placeholder`);
    headers = headers.replaceAll(placeholder, values[placeholder]);
  }
  const long = headers.split('\n').find((line) => line.length > MAX_HEADER_LINE);
  if (long) throw new Error(`a _headers line is ${long.length} characters; Cloudflare reads at most ${MAX_HEADER_LINE}`);
  fs.writeFileSync(headersFile, headers);

  return { pages: files.length, scriptHashes, styleHashes };
}
