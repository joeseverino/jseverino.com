// Fixed operations on the live site: read-only D1 queries, the additive schema apply, and a security-header
// check. Not a shell: statements are internal, and the schema write refuses without confirm.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { errorMessage } from '../../src/lib/error-message.ts';
import { cspReportUri, SITE, SITE_ORIGIN } from '../../src/lib/site-config.ts';
import { siteRoot } from '../../src/lib/site-root.ts';
import { createClient } from './cloudflare.ts';
import { DetailedError } from './detailed-error.ts';
import { type SpawnResult, spawnResult } from './run.ts';

export type Runner = (cmd: string, args: readonly string[], options: { cwd: string; timeout: number }) => SpawnResult;

export interface SiteOpsConfig {
  d1Database: string;
  siteRepo: string;
  siteOrigin: string;
  auditLog: string;
  token: string | undefined;
  accountId: string | undefined;
  run: Runner;
  fetch: typeof fetch;
}

// The production site; tests pass their own. Cloudflare credentials come from
// the environment (injected by `op run`), the same as every other Cloudflare script here.
export function siteOpsConfig(): SiteOpsConfig {
  return {
    d1Database: SITE.d1,
    siteRepo: siteRoot,
    siteOrigin: SITE_ORIGIN,
    auditLog: path.join(os.homedir(), '.local', 'state', 'jseverino.com', 'audit.log'),
    token: process.env.CLOUDFLARE_API_TOKEN,
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    run: spawnResult,
    fetch: globalThis.fetch,
  };
}

export class SiteOpsError extends DetailedError {}

const MISSING = {
  CLOUDFLARE_API_TOKEN: 'CLOUDFLARE_API_TOKEN is not set: D1 reads need an API token with Account · D1 · Read',
  CLOUDFLARE_ACCOUNT_ID: 'CLOUDFLARE_ACCOUNT_ID is not set: D1 reads need the account id the token (Account · D1 · Read) belongs to',
};

type Row = Record<string, unknown>;

interface D1Result {
  database: string;
  results: Row[];
  meta: Row;
}

const bounded = (value: number | undefined, fallback: number, max = 100): number => {
  const n = Number.isFinite(value) ? Math.trunc(value as number) : fallback;
  return Math.max(1, Math.min(n, max));
};

// Cloudflare's D1 HTTP API: the database is found by name, and every value travels in `params`.
// https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/
async function queryD1(config: SiteOpsConfig, sql: string, params: (string | number)[] = []): Promise<D1Result> {
  const { token, accountId } = config;
  if (!token) throw new SiteOpsError(MISSING.CLOUDFLARE_API_TOKEN, { credentials: true });
  if (!accountId) throw new SiteOpsError(MISSING.CLOUDFLARE_ACCOUNT_ID, { credentials: true });
  const client = createClient({ token, fetch: config.fetch });
  client.ids.account = accountId;
  try {
    const databases = await client.get<{ uuid: string; name: string }[]>(`/accounts/:account/d1/database?name=${encodeURIComponent(config.d1Database)}`);
    const database = databases.find((candidate) => candidate.name === config.d1Database);
    if (!database) throw new SiteOpsError(`the token cannot see a D1 database named ${config.d1Database}`);
    client.ids.database = database.uuid;
    const payload = await client.request<{ results?: Row[]; meta?: Row; success?: boolean }[]>('POST', '/accounts/:account/d1/database/:database/query', {
      sql,
      params,
    });
    const first = payload.result?.[0];
    if (first?.success === false) throw new SiteOpsError('D1 reported a failed statement', { result: first });
    return { database: config.d1Database, results: first?.results ?? [], meta: first?.meta ?? {} };
  } catch (error) {
    if (error instanceof SiteOpsError) throw error;
    throw new SiteOpsError(`D1 query failed: ${errorMessage(error)}`);
  }
}

// PII is released only once its access is on record, so an unwritable log fails the read.
function audit(config: SiteOpsConfig, action: string, detail: string): void {
  try {
    fs.mkdirSync(path.dirname(config.auditLog), { recursive: true, mode: 0o700 });
    fs.appendFileSync(config.auditLog, `${new Date().toISOString()} action=${action} ${detail} client=site\n`, { mode: 0o600 });
  } catch (error) {
    throw new SiteOpsError(`cannot write the audit log ${config.auditLog}: ${errorMessage(error)}`, { auditLog: config.auditLog });
  }
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
    id: row.id,
    created_at: row.created_at,
    name: abbreviateName(String(row.name ?? '')),
    email: redactEmail(String(row.email ?? '')),
    message_preview: preview(message),
    message_chars: message.length,
    status: row.status,
    browser: row.browser,
    device: row.device,
    country: row.country,
    source_url: row.source_url,
  };
};

export interface PiiRows extends D1Result {
  piiReleased: boolean;
  advisory?: string;
}

// Recent contact submissions. Redacted by default (abbreviated name, masked
// email, message preview); includePii releases full rows and is audited.
export async function contactSubmissions(
  config: SiteOpsConfig,
  { limit, includePii = false }: { limit?: number | undefined; includePii?: boolean } = {},
): Promise<PiiRows> {
  const n = bounded(limit, 10);
  const result = await queryD1(
    config,
    'SELECT id, created_at, name, email, message, status, browser, device, country, source_url, ip_address, user_agent, admin_notes ' +
      'FROM contact_submissions ORDER BY created_at DESC LIMIT ?;',
    [n],
  );
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
export async function cspReports(
  config: SiteOpsConfig,
  { limit, directive, includePii = false }: { limit?: number | undefined; directive?: string | undefined; includePii?: boolean } = {},
): Promise<PiiRows> {
  const n = bounded(limit, 20);
  const filter = directive?.trim().slice(0, 128);
  const where = filter ? 'WHERE effective_directive = ? ' : '';
  const columns =
    'id, created_at, effective_directive, blocked_uri, document_uri, source_file, status_code' +
    (includePii ? ', ip_address, user_agent, country, raw_report' : '');
  const result = await queryD1(config, `SELECT ${columns} FROM csp_reports ${where}ORDER BY created_at DESC LIMIT ?;`, [...(filter ? [filter] : []), n]);
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

export async function cspCounts(config: SiteOpsConfig): Promise<CspCounts> {
  const total = await queryD1(config, 'SELECT COUNT(*) AS total FROM csp_reports;');
  const grouped = await queryD1(
    config,
    "SELECT COALESCE(effective_directive, '(unknown)') AS effective_directive, COUNT(*) AS count FROM csp_reports " +
      'GROUP BY effective_directive ORDER BY count DESC, effective_directive ASC;',
  );
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
  // `site` runs as a mise task, which puts node_modules/.bin (wrangler) on PATH.
  const proc = config.run('wrangler', ['d1', 'execute', config.d1Database, '--remote', '--file=cloudflare/d1.sql'], { cwd: config.siteRepo, timeout: 120_000 });
  const output = `${proc.stdout}${proc.stderr}`.trim() || proc.error?.message || '';
  if (proc.code !== 0) throw new SiteOpsError(`${command} failed`, { exit_code: proc.code, output });
  return { applied: true, command, output };
}

const SECURITY_HEADERS = [
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
  httpStatus: number;
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
  if (!target.startsWith('/') || target.startsWith('//')) throw new SiteOpsError('path must be root-relative, e.g. / or /contact/', { usage: true });
  const url = `${config.siteOrigin.replace(/\/$/, '')}${target}`;
  let response: Response;
  try {
    response = await config.fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    throw new SiteOpsError(`HEAD ${url} failed: ${errorMessage(error)}`, { network: true });
  }
  const headers = Object.fromEntries(SECURITY_HEADERS.map((name) => [name, response.headers.get(name)])) as HeaderCheck['headers'];
  const csp = headers['content-security-policy'] ?? '';
  const reporting = headers['reporting-endpoints'] ?? '';
  return {
    url,
    httpStatus: response.status,
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
