// Shared subset of D1 used by the edge endpoints; no runtime dependency.
export interface D1Result {
  success: boolean;
  meta: { changes: number };
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<D1Result>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

// Row shapes of cloudflare/d1.sql; check-functions-parity holds each to its CREATE TABLE.

// D1 table contact_submissions
export interface ContactSubmissionRow {
  id: number;
  name: string;
  email: string;
  message: string;
  status: string;
  turnstile: string;
  ip_address: string | null;
  user_agent: string | null;
  browser: string | null;
  device: string | null;
  country: string | null;
  source_url: string | null;
  assigned_to: string | null;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
}

// D1 table csp_reports
export interface CspReportRow {
  id: number;
  document_uri: string | null;
  blocked_uri: string | null;
  effective_directive: string | null;
  violated_directive: string | null;
  disposition: string | null;
  referrer: string | null;
  source_file: string | null;
  line_number: number | null;
  column_number: number | null;
  status_code: number | null;
  user_agent: string | null;
  ip_address: string | null;
  country: string | null;
  raw_report: string;
  created_at: string;
}
