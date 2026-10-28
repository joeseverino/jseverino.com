// `site` commands over the live-site operations (bin/lib/site-ops.ts).

import { INSTALL_PACKAGES } from '../lib/preflight.ts';
import { applyD1Schema, contactSubmissions, cspCounts, cspReports, SiteOpsError, siteOpsConfig } from '../lib/site-ops.ts';
import { EXIT, type Output, SiteError, translate } from './cli.ts';
import type { ContactResult, CspResult, D1ApplyResult } from './types.ts';

const CLOUDFLARE_FIX = `needs CLOUDFLARE_API_TOKEN in the environment (op run) and ${INSTALL_PACKAGES} in the site repo`;
const D1_READ_FIX = 'set CLOUDFLARE_API_TOKEN (Account · D1 · Read) and CLOUDFLARE_ACCOUNT_ID through op run';

// fix names the remedy for a failure; usage, for a refused or malformed request.
const guard = <T>(work: () => T | Promise<T>, { fix, usage }: { fix: string; usage?: string }): Promise<T> =>
  translate(work, SiteOpsError, (error) => {
    const refused = error.details.refused === true || error.details.usage === true;
    return new SiteError(error.message, {
      code: refused ? EXIT.usage : EXIT.failed,
      result: error.details,
      fix: refused && usage ? usage : fix,
    });
  });

const limit = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new SiteError('--limit must be a positive integer', { code: EXIT.usage });
  return n;
};

export async function contact({ limit: max, pii, out }: { limit: string | undefined; pii: boolean; out: Output }): Promise<ContactResult> {
  const result = await guard(() => contactSubmissions(siteOpsConfig(), { limit: limit(max), includePii: pii }), { fix: D1_READ_FIX });
  for (const row of result.results)
    out.text(`  ${String(row.created_at)}  ${String(row.name)}  ${String(row.email)}  ${String(row.message_preview ?? row.message ?? '')}`);
  if (result.advisory) out.step('redacted', result.advisory);
  return { ...result, next: null };
}

export async function csp({
  count,
  limit: max,
  directive,
  pii,
  out,
}: {
  count: boolean;
  limit: string | undefined;
  directive: string | undefined;
  pii: boolean;
  out: Output;
}): Promise<CspResult> {
  if (count) {
    const counts = await guard(() => cspCounts(siteOpsConfig()), { fix: D1_READ_FIX });
    out.text(`  total ${counts.total}`);
    for (const row of counts.byDirective) out.text(`  ${String(row.count).padStart(6)}  ${row.effective_directive}`);
    return { mode: 'count', ...counts, next: null };
  }
  const result = await guard(() => cspReports(siteOpsConfig(), { limit: limit(max), directive, includePii: pii }), { fix: D1_READ_FIX });
  for (const row of result.results) out.text(`  ${String(row.created_at)}  ${String(row.effective_directive)}  ${String(row.blocked_uri)}`);
  return { mode: 'list', ...result, next: null };
}

export async function d1Apply({ confirm, out }: { confirm: boolean; out: Output }): Promise<D1ApplyResult> {
  const result = await guard(() => applyD1Schema(siteOpsConfig(), { confirm }), { fix: CLOUDFLARE_FIX, usage: 'pass --confirm to apply' });
  out.ok('applied', result.command);
  return { ...result, next: null };
}
