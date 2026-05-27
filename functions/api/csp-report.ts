// Cloudflare Pages Function — POST /api/csp-report
//
// Receives browser CSP violation reports from the enforced site policy and
// stores a compact, normalized record in D1 for review.

interface D1Result {
  success: boolean;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<D1Result>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

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
const SITE_ORIGIN = 'https://jseverino.com';
const IGNORED_BLOCKED_URI_PREFIXES = [
  'chrome-extension:',
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

function isAllowedContentType(contentType: string): boolean {
  const normalized = contentType.toLowerCase();
  return (
    normalized.includes('application/csp-report') ||
    normalized.includes('application/reports+json') ||
    normalized.includes('application/json')
  );
}

function asString(value: unknown, max = MAX_FIELD_LENGTH): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

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
  return (
    !isSiteDocument(report.documentUri) ||
    IGNORED_BLOCKED_URI_PREFIXES.some((prefix) => blocked.startsWith(prefix))
  );
}

function normalizeLegacy(report: Record<string, unknown>): NormalizedReport {
  return {
    documentUri: asString(report['document-uri']),
    blockedUri: asString(report['blocked-uri']),
    effectiveDirective: asString(report['effective-directive'], MAX_DIRECTIVE_LENGTH),
    violatedDirective: asString(report['violated-directive'], MAX_DIRECTIVE_LENGTH),
    disposition: asString(report.disposition, MAX_DIRECTIVE_LENGTH),
    referrer: asString(report.referrer),
    sourceFile: asString(report['source-file']),
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
    documentUri: asString(body.documentURL || report.url),
    blockedUri: asString(body.blockedURL),
    effectiveDirective: asString(body.effectiveDirective, MAX_DIRECTIVE_LENGTH),
    violatedDirective: asString(body.effectiveDirective, MAX_DIRECTIVE_LENGTH),
    disposition: asString(body.disposition, MAX_DIRECTIVE_LENGTH),
    referrer: asString(body.referrer),
    sourceFile: asString(body.sourceFile),
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

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  const contentType = request.headers.get('Content-Type') ?? '';

  if (!isAllowedContentType(contentType)) {
    return noContent(415);
  }

  const contentLength = Number(request.headers.get('Content-Length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return noContent(413);
  }

  let reports: NormalizedReport[];
  try {
    const body = await request.text();
    if (body.length > MAX_BODY_BYTES) {
      return noContent(413);
    }
    reports = normalizeReports(JSON.parse(body));
  } catch {
    return noContent(400);
  }

  if (reports.length === 0) {
    return noContent(400);
  }

  const userAgent = asString(request.headers.get('User-Agent'), MAX_USER_AGENT_LENGTH);
  const ip = asString(request.headers.get('CF-Connecting-IP'), 64);
  const country = asString(request.headers.get('CF-IPCountry'), 2);

  try {
    for (const report of reports) {
      await env.DB.prepare(
        `INSERT INTO csp_reports
           (document_uri, blocked_uri, effective_directive, violated_directive,
            disposition, referrer, source_file, line_number, column_number,
            status_code, user_agent, ip_address, country, raw_report)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
      )
        .bind(
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
        )
        .run();
    }
  } catch (error) {
    console.error('D1 CSP report insert failed', error);
    return noContent(500);
  }

  return noContent();
}
