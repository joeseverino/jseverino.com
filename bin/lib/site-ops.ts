// Fixed operations on the live site: read-only D1 queries, the additive schema apply, and a security-header
// check. Not a shell: statements are internal, and the schema write refuses without confirm.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DetailedError } from './detailed-error.ts';
import { spawnResult, type SpawnResult } from './run.ts';
import { cspReportUri } from '../../src/lib/edge-expectations.ts';
import { SITE_ORIGIN } from '../../src/lib/site-config.ts';
import { siteRoot } from '../../src/lib/site-root.ts';
import { errorMessage } from '../../src/lib/error-message.ts';

export type Runner = (cmd: string, args: readonly string[], options: { cwd: string; timeout: number }) => SpawnResult;

export interface SiteOpsConfig {
  d1Database: string;
  siteRepo: string;
  siteOrigin: string;
  auditLog: string;
  run: Runner;
  fetch: typeof fetch;
}

// Cloudflare credentials come from the environment (CLOUDFLARE_API_TOKEN,
// injected by `op run`), the same as every other Cloudflare script here.
export function siteOpsConfig(env: NodeJS.ProcessEnv = process.env): SiteOpsConfig {
  return {
    d1Database: env.SITE_D1_DATABASE || 'jseverino-contact',
    siteRepo: env.SITE_REPO || siteRoot,
    siteOrigin: env.SITE_ORIGIN || SITE_ORIGIN,
    auditLog: env.SITE_AUDIT_LOG || path.join(os.homedir(), '.local', 'state', 'jseverino.com', 'audit.log'),
    run: (cmd, args, { cwd, timeout }) => spawnResult(cmd, args, { cwd, timeout }),
    fetch: globalThis.fetch,
  };
}

export class SiteOpsError extends DetailedError {}

type Row = Record<string, unknown>;

export interface D1Result {
  database: string;
  results: Row[];
  meta: Row;
}

const bounded = (value: number | undefined, fallback: number, max = 100): number => {
  const n = Number.isFinite(value) ? Math.trunc(value as number) : fallback;
  return Math.max(1, Math.min(n, max));
};

const sqlString = (value: string): string => `'${value.replaceAll("'", "''")}'`;

// Run the repo's own wrangler, failing clearly when it is not installed.
function runWrangler(config: SiteOpsConfig, args: string[], timeout: number): SpawnResult {
  const bin = path.join(config.siteRepo, 'node_modules', '.bin', 'wrangler');
  if (!fs.existsSync(bin)) throw new SiteOpsError(`wrangler not installed in ${config.siteRepo}; run npm ci there`);
  return config.run(bin, args, { cwd: config.siteRepo, timeout });
}

function runD1(config: SiteOpsConfig, sql: string, timeout = 20_000): D1Result {
  const proc = runWrangler(config, ['d1', 'execute', config.d1Database, '--remote', '--json', '--command', sql], timeout);
  if (proc.code !== 0) {
    throw new SiteOpsError(`wrangler d1 execute failed: ${proc.stderr.trim() || proc.error?.message || `exit ${proc.code}`}`, {
      exit_code: proc.code, stdout: proc.stdout.trim(),
    });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(proc.stdout);
  } catch {
    throw new SiteOpsError('wrangler returned non-JSON output', { stdout: proc.stdout });
  }
  const first = (Array.isArray(payload) ? payload[0] : undefined) as { success?: boolean; results?: Row[]; meta?: Row } | undefined;
  if (first?.success === false) throw new SiteOpsError('D1 reported a failed statement', { result: first });
  return { database: config.d1Database, results: first?.results ?? [], meta: first?.meta ?? {} };
}

// Best effort: an audit failure never fails the read it records.
function audit(config: SiteOpsConfig, action: string, detail: string): void {
  try {
    fs.mkdirSync(path.dirname(config.auditLog), { recursive: true });
    fs.appendFileSync(config.auditLog, `${new Date().toISOString()} action=${action} ${detail} client=site\n`);
    fs.chmodSync(config.auditLog, 0o600);
  } catch {}
}

export const redactEmail = (email: string): string => {
  const value = email.trim();
  const at = value.indexOf('@');
  if (at === -1) return value ? '***' : '';
  return `${value.slice(0, 1)}***@${value.slice(at + 1)}`;
};

export const abbreviateName = (name: string): string => {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts[0]} ${(parts.at(-1) ?? '').slice(0, 1)}.`;
};

export const preview = (text: string, limit = 80): string => {
  const collapsed = text.split(/\s+/).filter(Boolean).join(' ');
  return collapsed.length <= limit ? collapsed : `${collapsed.slice(0, limit).trimEnd()}…`;
};

const redactContact = (row: Row): Row => {
  const message = String(row.message ?? '');
  return {
    id: row.id, created_at: row.created_at,
    name: abbreviateName(String(row.name ?? '')), email: redactEmail(String(row.email ?? '')),
    message_preview: preview(message), message_chars: message.length,
    status: row.status, browser: row.browser, device: row.device, country: row.country, source_url: row.source_url,
  };
};

export interface PiiRows extends D1Result {
  piiReleased: boolean;
  advisory?: string;
}

// Recent contact submissions. Redacted by default (abbreviated name, masked
// email, message preview); includePii releases full rows and is audited.
export function contactSubmissions(config: SiteOpsConfig, { limit, includePii = false }: { limit?: number | undefined; includePii?: boolean } = {}): PiiRows {
  const n = bounded(limit, 10);
  const result = runD1(config,
    'SELECT id, created_at, name, email, message, status, browser, device, country, source_url, ip_address, user_agent, admin_notes '
    + `FROM contact_submissions ORDER BY created_at DESC LIMIT ${n};`);
  if (includePii) {
    audit(config, 'contact_pii_access', `rows=${result.results.length}`);
    return { ...result, piiReleased: true };
  }
  return {
    ...result,
    results: result.results.map(redactContact),
    piiReleased: false,
    advisory: 'Contact PII redacted (name abbreviated, email masked, message previewed). --pii releases full rows and is audited.',
  };
}

// Recent CSP reports; client identifiers only with includePii (audited).
export function cspReports(
  config: SiteOpsConfig,
  { limit, directive, includePii = false }: { limit?: number | undefined; directive?: string | undefined; includePii?: boolean } = {},
): PiiRows {
  const n = bounded(limit, 20);
  const filter = directive?.trim().slice(0, 128);
  const where = filter ? `WHERE effective_directive = ${sqlString(filter)} ` : '';
  const columns = 'id, created_at, effective_directive, blocked_uri, document_uri, source_file, status_code'
    + (includePii ? ', ip_address, user_agent, country, raw_report' : '');
  const result = runD1(config, `SELECT ${columns} FROM csp_reports ${where}ORDER BY created_at DESC LIMIT ${n};`);
  if (includePii) {
    audit(config, 'csp_pii_access', `rows=${result.results.length}`);
    return { ...result, piiReleased: true };
  }
  return { ...result, piiReleased: false, advisory: 'CSP client fields (ip_address, user_agent, raw_report) omitted. --pii includes them and is audited.' };
}

export interface CspCounts {
  database: string;
  total: number;
  byDirective: { effective_directive: string; count: number }[];
}

export function cspCounts(config: SiteOpsConfig): CspCounts {
  const total = runD1(config, 'SELECT COUNT(*) AS total FROM csp_reports;');
  const grouped = runD1(config,
    "SELECT COALESCE(effective_directive, '(unknown)') AS effective_directive, COUNT(*) AS count FROM csp_reports "
    + 'GROUP BY effective_directive ORDER BY count DESC, effective_directive ASC;');
  return {
    database: config.d1Database,
    total: Number(total.results[0]?.total ?? 0),
    byDirective: grouped.results.map((row) => ({ effective_directive: String(row.effective_directive), count: Number(row.count) })),
  };
}

export interface SchemaApply {
  applied: boolean;
  command: string;
  output: string;
}

// Apply cloudflare/d1.sql (CREATE ... IF NOT EXISTS) remotely; refuses without confirm.
export function applyD1Schema(config: SiteOpsConfig, { confirm = false }: { confirm?: boolean } = {}): SchemaApply {
  const command = `wrangler d1 execute ${config.d1Database} --remote --file=cloudflare/d1.sql`;
  if (!confirm) throw new SiteOpsError('refusing to apply the D1 schema without confirm', { refused: true, command });
  const proc = runWrangler(config, ['d1', 'execute', config.d1Database, '--remote', '--file=cloudflare/d1.sql'], 120_000);
  const output = `${proc.stdout}${proc.stderr}`.trim();
  if (proc.code !== 0) throw new SiteOpsError(`${command} failed`, { exit_code: proc.code, output });
  return { applied: true, command, output };
}

export const SECURITY_HEADERS = [
  'content-security-policy',
  'reporting-endpoints',
  'strict-transport-security',
  'x-content-type-options',
  'referrer-policy',
  'permissions-policy',
  'cross-origin-opener-policy',
  'cross-origin-resource-policy',
] as const;

export interface HeaderCheck {
  url: string;
  status: number;
  ok: boolean;
  headers: Record<(typeof SECURITY_HEADERS)[number], string | null>;
  checks: {
    hasCsp: boolean;
    noUnsafeInlineScript: boolean;
    hasCspReportTo: boolean;
    hasCspReportUri: boolean;
    hasReportingEndpoints: boolean;
  };
}

// HEAD one root-relative path on the live origin, without following redirects.
export async function checkSecurityHeaders(config: SiteOpsConfig, pathname = '/'): Promise<HeaderCheck> {
  const target = pathname.trim() || '/';
  if (!target.startsWith('/') || target.startsWith('//')) throw new SiteOpsError('path must be root-relative, e.g. / or /contact/');
  const url = `${config.siteOrigin.replace(/\/$/, '')}${target}`;
  let response: Response;
  try {
    response = await config.fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    throw new SiteOpsError(`HEAD ${url} failed: ${errorMessage(error)}`);
  }
  const headers = Object.fromEntries(SECURITY_HEADERS.map((name) => [name, response.headers.get(name)])) as HeaderCheck['headers'];
  const csp = headers['content-security-policy'] ?? '';
  const reporting = headers['reporting-endpoints'] ?? '';
  return {
    url,
    status: response.status,
    ok: response.status >= 200 && response.status < 400,
    headers,
    checks: {
      hasCsp: csp !== '',
      noUnsafeInlineScript: !/script-src[^;]*'unsafe-inline'/.test(csp),
      hasCspReportTo: csp.includes('report-to csp-endpoint'),
      hasCspReportUri: csp.includes(`report-uri ${cspReportUri}`),
      hasReportingEndpoints: reporting.includes('csp-endpoint='),
    },
  };
}
