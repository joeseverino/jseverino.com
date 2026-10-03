// Cloudflare Pages Function: POST /api/csp-report
//
// Receives browser CSP violation reports from the enforced site policy and
// stores a compact, normalized record in D1 for review. The endpoint is open
// by necessity, so writes are bounded: one batch per request, a report
// identical to one stored in the last hour is skipped, and each IP gets a
// fixed number of stored reports per hour.

import { SITE } from '../generated/site.ts';
import type { D1Database } from '../lib/database.ts';
import { asString, requestMeta } from '../lib/request-meta.ts';
import { readRequestJson, requestMediaType, type PostContext } from '../lib/request-json.ts';

interface Env {
  DB: D1Database;
}

type LegacyCspReport = {
  'csp-report'?: Record<string, unknown>;
};

type ReportingApiReport = {
  type?: unknown;
  url?: unknown;
  body?: Record<string, unknown>;
};

type NormalizedReport = {
  documentUri: string;
  blockedUri: string;
  effectiveDirective: string;
  violatedDirective: string;
  disposition: string;
  referrer: string;
  sourceFile: string;
  lineNumber: number | null;
  columnNumber: number | null;
  statusCode: number | null;
  rawReport: string;
};

const MAX_BODY_BYTES = 16_384;
const MAX_REPORTS_PER_REQUEST = 10;
const MAX_FIELD_LENGTH = 2_048;
const MAX_DIRECTIVE_LENGTH = 256;
const MAX_USER_AGENT_LENGTH = 512;
const MAX_STORED_PER_IP_PER_HOUR = 30;
const SITE_ORIGIN = SITE.origin;
const IGNORED_BLOCKED_URI_PREFIXES = [
  'chrome-extension:',
  'moz-extension:',
  'safari-web-extension:',
  'edge-extension:',
];
const IGNORED_SOURCE_FILE_PREFIXES = [
  'chrome-extension',
  'moz-extension:',
  'safari-web-extension:',
  'edge-extension:',
];

function noContent(status = 204): Response {
  return new Response(null, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

const ALLOWED_MEDIA_TYPES = new Set(['application/csp-report', 'application/reports+json', 'application/json']);

const field = (value: unknown) => asString(value, MAX_FIELD_LENGTH);
const directive = (value: unknown) => asString(value, MAX_DIRECTIVE_LENGTH);

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function rawJson(value: unknown): string {
  const serialized = JSON.stringify(value);
  return serialized.length > MAX_BODY_BYTES ? serialized.slice(0, MAX_BODY_BYTES) : serialized;
}

function isSiteDocument(documentUri: string): boolean {
  if (!documentUri) return false;
  try {
    return new URL(documentUri).origin === SITE_ORIGIN;
  } catch {
    return false;
  }
}

function isIgnoredReport(report: NormalizedReport): boolean {
  const blocked = report.blockedUri.toLowerCase();
  const sourceFile = report.sourceFile.toLowerCase();
  return (
    !isSiteDocument(report.documentUri) ||
    IGNORED_BLOCKED_URI_PREFIXES.some((prefix) => blocked.startsWith(prefix)) ||
    IGNORED_SOURCE_FILE_PREFIXES.some((prefix) => sourceFile.startsWith(prefix)) ||
    // Extensions like AdGuard inject inline <style>/<script> directly into the
    // page DOM, so the browser attributes the violation to our document instead
    // of an extension scheme. Pages on this site ship zero inline styles and
    // the only inline script is the nonce-bearing JSON-LD block, so any
    // `inline`-blocked report whose source matches the document URI is an
    // injection from a browser extension or page-level content filter.
    (blocked === 'inline' && report.sourceFile === report.documentUri)
  );
}

function normalizeLegacy(report: Record<string, unknown>): NormalizedReport {
  return {
    documentUri: field(report['document-uri']),
    blockedUri: field(report['blocked-uri']),
    effectiveDirective: directive(report['effective-directive']),
    violatedDirective: directive(report['violated-directive']),
    disposition: directive(report.disposition),
    referrer: field(report.referrer),
    sourceFile: field(report['source-file']),
    lineNumber: asNumber(report['line-number']),
    columnNumber: asNumber(report['column-number']),
    statusCode: asNumber(report['status-code']),
    rawReport: rawJson(report),
  };
}

function normalizeReportingApi(report: ReportingApiReport): NormalizedReport | null {
  if (report.type !== 'csp-violation' || !report.body) return null;
  const body = report.body;
  return {
    documentUri: field(body.documentURL || report.url),
    blockedUri: field(body.blockedURL),
    effectiveDirective: directive(body.effectiveDirective),
    violatedDirective: directive(body.effectiveDirective),
    disposition: directive(body.disposition),
    referrer: field(body.referrer),
    sourceFile: field(body.sourceFile),
    lineNumber: asNumber(body.lineNumber),
    columnNumber: asNumber(body.columnNumber),
    statusCode: asNumber(body.statusCode),
    rawReport: rawJson(report),
  };
}

function normalizeReports(payload: unknown): NormalizedReport[] {
  const reports = Array.isArray(payload) ? payload : [payload];
  return reports
    .slice(0, MAX_REPORTS_PER_REQUEST)
    .map((report) => {
      if (!report || typeof report !== 'object') return null;
      const legacy = (report as LegacyCspReport)['csp-report'];
      if (legacy && typeof legacy === 'object') return normalizeLegacy(legacy);
      return normalizeReportingApi(report as ReportingApiReport);
    })
    .filter((report): report is NormalizedReport => report !== null && !isIgnoredReport(report));
}

export async function onRequestPost({ request, env }: PostContext<Env>): Promise<Response> {
  if (!ALLOWED_MEDIA_TYPES.has(requestMediaType(request))) {
    return noContent(415);
  }

  const payload = await readRequestJson(request, MAX_BODY_BYTES);
  if (!payload.ok) return noContent(payload.status);
  const reports = normalizeReports(payload.value);

  if (reports.length === 0) {
    return noContent(400);
  }

  const { ip, userAgent, country } = requestMeta(request, MAX_USER_AGENT_LENGTH);
  const insert = env.DB.prepare(
    `INSERT INTO csp_reports
       (document_uri, blocked_uri, effective_directive, violated_directive,
        disposition, referrer, source_file, line_number, column_number,
        status_code, user_agent, ip_address, country, raw_report)
     SELECT * FROM (VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14))
     WHERE (?12 IS NULL
            OR (SELECT COUNT(*) FROM csp_reports
                WHERE ip_address = ?12 AND created_at > datetime('now', '-1 hour')) < ?15)
       AND NOT EXISTS (
         SELECT 1 FROM csp_reports
         WHERE blocked_uri IS ?2 AND created_at > datetime('now', '-1 hour')
           AND document_uri IS ?1 AND effective_directive IS ?3 AND disposition IS ?5
           AND source_file IS ?7 AND line_number IS ?8 AND column_number IS ?9)`,
  );

  try {
    // One batch is one round trip and one transaction, so the cap and the
    // duplicate check also see the rows earlier in the same request.
    await env.DB.batch(
      reports.map((report) =>
        insert.bind(
          report.documentUri || null,
          report.blockedUri || null,
          report.effectiveDirective || null,
          report.violatedDirective || null,
          report.disposition || null,
          report.referrer || null,
          report.sourceFile || null,
          report.lineNumber,
          report.columnNumber,
          report.statusCode,
          userAgent || null,
          ip || null,
          country || null,
          report.rawReport,
          MAX_STORED_PER_IP_PER_HOUR,
        ),
      ),
    );
  } catch (error) {
    console.error('D1 CSP report insert failed', error);
    return noContent(500);
  }

  return noContent();
}
