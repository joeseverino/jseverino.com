#!/usr/bin/env node
// Turn the built pages into the site's headers: hash the inline script and the
// inlined stylesheet every page carries, fail on any script or style the policy
// would not cover, and write the Content-Security-Policy into dist/_headers in
// place of the placeholders public/_headers holds. Runs from build-static after
// the sitedrift wrap, so a preview build is scanned as it will be served.
//
//   node bin/build-csp.ts [dist-dir]
import fs from 'node:fs';
import path from 'node:path';
import { SITE } from '../functions/generated/site.ts';
import { htmlPolicy, reportingEndpoints, scanInline, trustedTypesReportOnly } from '../functions/lib/csp.ts';
import { walkFiles } from '../src/lib/walk.ts';
import { buildOutDir } from '../src/lib/build-output.ts';
import { siteRoot } from '../src/lib/site-root.ts';
import { cli } from './lib/args.ts';

// Cloudflare ignores a _headers line past this length.
const MAX_HEADER_LINE = 2000;
// A page that grows a fifth distinct inline script is a design change, not drift.
const MAX_HASHES = 4;

export const PLACEHOLDERS = ['__CSP__', '__CSP_CONTACT__', '__TT_REPORT_ONLY__', '__REPORTING_ENDPOINTS__'] as const;

export async function buildCsp(distDir: string): Promise<{ pages: number; scriptHashes: string[]; styleHashes: string[] }> {
  const files = walkFiles(distDir, { filter: (file) => file.endsWith('.html') });
  const scans = await Promise.all(files.map(async (file) => ({ file, scan: await scanInline(fs.readFileSync(file, 'utf8')) })));

  const problems = scans.flatMap(({ file, scan }) => scan.problems.map((problem) => `${path.relative(distDir, file)}: ${problem}`));
  if (problems.length > 0) {
    throw new Error(`markup the Content Security Policy would block:\n  ${problems.join('\n  ')}`);
  }
  const scriptHashes = [...new Set(scans.flatMap(({ scan }) => scan.scriptHashes))];
  const styleHashes = [...new Set(scans.flatMap(({ scan }) => scan.styleHashes))];
  if (scriptHashes.length > MAX_HASHES || styleHashes.length > MAX_HASHES) {
    throw new Error(`${scriptHashes.length} inline script and ${styleHashes.length} inline style hashes; expected at most ${MAX_HASHES} of each`);
  }
  for (const { file, scan } of scans) fs.writeFileSync(file, scan.html);

  const input = { scriptHashes, styleHashes, reportUri: SITE.cspReportUri };
  const values: Record<(typeof PLACEHOLDERS)[number], string> = {
    __CSP__: htmlPolicy({ ...input, trustedTypes: true }),
    __CSP_CONTACT__: htmlPolicy({ ...input, trustedTypes: false }),
    __TT_REPORT_ONLY__: trustedTypesReportOnly(SITE.cspReportUri),
    __REPORTING_ENDPOINTS__: reportingEndpoints(SITE.cspReportUri),
  };

  const headersFile = path.join(distDir, '_headers');
  let headers = fs.readFileSync(headersFile, 'utf8');
  for (const placeholder of PLACEHOLDERS) {
    if (!headers.includes(placeholder)) throw new Error(`_headers has no ${placeholder} placeholder`);
    headers = headers.replaceAll(placeholder, values[placeholder]);
  }
  const long = headers.split('\n').find((line) => line.length > MAX_HEADER_LINE);
  if (long) throw new Error(`a _headers line is ${long.length} characters; Cloudflare reads at most ${MAX_HEADER_LINE}`);
  fs.writeFileSync(headersFile, headers);

  return { pages: files.length, scriptHashes, styleHashes };
}

if (import.meta.main) {
  const { positionals } = cli({ usage: 'usage: node bin/build-csp.ts [dist-dir]', allowPositionals: true });
  const { pages, scriptHashes, styleHashes } = await buildCsp(path.resolve(siteRoot, positionals[0] ?? buildOutDir));
  console.log(`csp: ${pages} pages, ${scriptHashes.length} inline script and ${styleHashes.length} inline style hash(es) written to _headers`);
}
