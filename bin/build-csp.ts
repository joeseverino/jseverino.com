// Hash each page's inline script and stylesheet, fail on any the policy would not
// cover, and write the CSP into the built _headers. The build runs it once; a preview
// deploy runs it again on the same build after the sitedrift wrap.
import fs from 'node:fs';
import path from 'node:path';
import { cspReportUri } from '../src/lib/site-config.ts';
import { hashSource, htmlPolicy, reportingEndpoints, scanInline, trustedTypesReportOnly } from '../src/lib/csp.ts';
import { readJson } from '../src/lib/json.ts';

// Cloudflare ignores a _headers line past this length.
const MAX_HEADER_LINE = 2000;
const MAX_HASHES = 4;

export const PLACEHOLDERS = ['__CSP__', '__CSP_CONTACT__', '__TT_REPORT_ONLY__', '__REPORTING_ENDPOINTS__'] as const;

interface PageRecord {
  // The page as this run wrote it.
  digest: string;
  scriptHashes: string[];
  styleHashes: string[];
}

// What a run filled in, so a later run on the same build starts from the same template and pages.
interface CspRecord {
  headers: string;
  pages: Record<string, PageRecord>;
}

export async function buildCsp(distDir: string, recordFile: string): Promise<{ pages: number; scriptHashes: string[]; styleHashes: string[] }> {
  const headersFile = path.join(distDir, '_headers');
  const current = fs.readFileSync(headersFile, 'utf8');
  // A _headers that still has a placeholder is fresh from the build; a filled one was filled from the record.
  const previous = PLACEHOLDERS.some((placeholder) => current.includes(placeholder)) || !fs.existsSync(recordFile)
    ? undefined
    : readJson<CspRecord>(recordFile);

  const files = fs.readdirSync(distDir, { recursive: true, encoding: 'utf8' }).filter((file) => file.endsWith('.html'));
  const scans = await Promise.all(files.map(async (file) => {
    const source = fs.readFileSync(path.join(distDir, file), 'utf8');
    // A page the last run wrote, unchanged since, has lost the marker a new scan would look for,
    // so it keeps the hashes found in it then.
    const kept = previous?.pages[file];
    const scan = kept?.digest === await hashSource(source)
      ? { html: source, scriptHashes: kept.scriptHashes, styleHashes: kept.styleHashes, problems: [] }
      : await scanInline(source);
    return { file, scan, digest: await hashSource(scan.html) };
  }));

  const problems = scans.flatMap(({ file, scan }) => scan.problems.map((problem) => `${file}: ${problem}`));
  if (problems.length > 0) {
    throw new Error(`markup the Content Security Policy would block:\n  ${problems.join('\n  ')}`);
  }

  const scriptHashes = [...new Set(scans.flatMap(({ scan }) => scan.scriptHashes))];
  const styleHashes = [...new Set(scans.flatMap(({ scan }) => scan.styleHashes))];
  if (scriptHashes.length > MAX_HASHES || styleHashes.length > MAX_HASHES) {
    throw new Error(`${scriptHashes.length} inline script and ${styleHashes.length} inline style hashes; expected at most ${MAX_HASHES} of each`);
  }
  for (const { file, scan } of scans) fs.writeFileSync(path.join(distDir, file), scan.html);

  const input = { scriptHashes, styleHashes, reportUri: cspReportUri };
  const values: Record<(typeof PLACEHOLDERS)[number], string> = {
    __CSP__: htmlPolicy({ ...input, trustedTypes: true }),
    __CSP_CONTACT__: htmlPolicy({ ...input, trustedTypes: false }),
    __TT_REPORT_ONLY__: trustedTypesReportOnly(cspReportUri),
    __REPORTING_ENDPOINTS__: reportingEndpoints(cspReportUri),
  };

  const template = previous?.headers ?? current;
  let headers = template;
  for (const placeholder of PLACEHOLDERS) {
    if (!headers.includes(placeholder)) throw new Error(`_headers has no ${placeholder} placeholder`);
    headers = headers.replaceAll(placeholder, values[placeholder]);
  }
  const long = headers.split('\n').find((line) => line.length > MAX_HEADER_LINE);
  if (long) throw new Error(`a _headers line is ${long.length} characters; Cloudflare reads at most ${MAX_HEADER_LINE}`);
  fs.writeFileSync(headersFile, headers);

  const pages = Object.fromEntries(scans.map(({ file, scan, digest }) =>
    [file, { digest, scriptHashes: scan.scriptHashes, styleHashes: scan.styleHashes }]));
  fs.writeFileSync(recordFile, JSON.stringify({ headers: template, pages } satisfies CspRecord));

  return { pages: files.length, scriptHashes, styleHashes };
}
