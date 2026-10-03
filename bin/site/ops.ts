// `site` commands over the live-site operations (bin/lib/site-ops.ts).
import {
  SiteOpsError, applyD1Schema, checkSecurityHeaders, contactSubmissions, cspCounts, cspReports, siteOpsConfig,
} from '../lib/site-ops.ts';
import { EXIT, SiteError, translate, type Output } from './cli.ts';
import type { ContactResult, CspResult, D1ApplyResult, HeadersResult } from './types.ts';

const guard = <T>(work: () => T | Promise<T>): Promise<T> => translate(work, SiteOpsError, (error) => {
  const refused = error.details.refused === true;
  return new SiteError(error.message, {
    code: refused ? EXIT.usage : EXIT.failed,
    result: error.details,
    fix: refused ? 'pass --confirm to apply' : 'needs CLOUDFLARE_API_TOKEN in the environment (op run) and npm ci in the site repo',
  });
});

const limit = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new SiteError('--limit must be a positive integer', { code: EXIT.usage });
  return n;
};

export async function contact({ limit: max, pii, out }: { limit: string | undefined; pii: boolean; out: Output }): Promise<ContactResult> {
  const result = await guard(() => contactSubmissions(siteOpsConfig(), { limit: limit(max), includePii: pii }));
  for (const row of result.results) out.text(`  ${String(row.created_at)}  ${String(row.name)}  ${String(row.email)}  ${String(row.message_preview ?? row.message ?? '')}`);
  if (result.advisory) out.step('redacted', result.advisory);
  return { ...result, next: null };
}

export async function csp({
  count, limit: max, directive, pii, out,
}: { count: boolean; limit: string | undefined; directive: string | undefined; pii: boolean; out: Output }): Promise<CspResult> {
  if (count) {
    const counts = await guard(() => cspCounts(siteOpsConfig()));
    out.text(`  total ${counts.total}`);
    for (const row of counts.byDirective) out.text(`  ${String(row.count).padStart(6)}  ${row.effective_directive}`);
    return { mode: 'count', ...counts, next: null };
  }
  const result = await guard(() => cspReports(siteOpsConfig(), { limit: limit(max), directive, includePii: pii }));
  for (const row of result.results) out.text(`  ${String(row.created_at)}  ${String(row.effective_directive)}  ${String(row.blocked_uri)}`);
  return { mode: 'list', ...result, next: null };
}

export async function d1Apply({ confirm, out }: { confirm: boolean; out: Output }): Promise<D1ApplyResult> {
  const result = await guard(() => applyD1Schema(siteOpsConfig(), { confirm }));
  out.ok('applied', result.command);
  return { ...result, next: null };
}

export async function headers({ path, out }: { path: string | undefined; out: Output }): Promise<HeadersResult> {
  const result = await guard(() => checkSecurityHeaders(siteOpsConfig(), path ?? '/'));
  out.text(`${result.status} ${result.url}`);
  for (const [name, passed] of Object.entries(result.checks)) (passed ? out.ok : out.fail)(passed ? 'ok' : 'missing', name);
  const failed = Object.values(result.checks).filter((passed) => !passed).length;
  if (!result.ok || failed > 0) {
    throw new SiteError(`${result.url}: ${result.ok ? `${failed} header checks failed` : `status ${result.status}`}`, { result });
  }
  return { ...result, next: null };
}
