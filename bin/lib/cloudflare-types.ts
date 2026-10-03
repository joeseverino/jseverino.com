// The Cloudflare desired state (cloudflare/zone.json, validated against
// cloudflare/zone.schema.json on load) and the slices of the v4 API responses
// bin/lib/cloudflare.ts reads. API shapes name only the fields this repo uses.

export type Toggle = 'on' | 'off';

// Type aliases so Object.entries keeps the value types (an interface would widen them).
export type ZoneSettings = {
  min_tls_version: '1.0' | '1.1' | '1.2' | '1.3';
  tls_1_3: 'on' | 'off' | 'zrt';
  always_use_https: Toggle;
  http3: Toggle;
  '0rtt': Toggle;
  speed_brain: Toggle;
  rocket_loader: Toggle;
  email_obfuscation: Toggle;
  server_side_exclude: Toggle;
  automatic_https_rewrites: Toggle;
  hotlink_protection?: Toggle;
  browser_cache_ttl: number;
  brotli: Toggle;
};

export type Hsts = {
  enabled: boolean;
  max_age: number;
  include_subdomains: boolean;
  preload: boolean;
};

export interface FirewallRuleSpec {
  id: string;
  description: string;
  expression: string;
  action: 'block' | 'managed_challenge';
}

export interface RateLimitSpec {
  id: string;
  description: string;
  expression: string;
  action: 'block';
  characteristics: string[];
  period: 10;
  requests_per_period: number;
  mitigation_timeout: 10;
}

export type PagesDevRedirect = {
  list: string;
  source_url: string;
  target_url: string;
  status_code: 301 | 302 | 307 | 308;
  preserve_query_string: boolean;
  subpath_matching: boolean;
  preserve_path_suffix: boolean;
  include_subdomains: boolean;
};

export interface SchemaValidationSpec {
  name: string;
  file: string;
  host: string;
  method: 'POST';
  endpoint: string;
  action: 'block';
}

export interface DesiredState {
  $schema?: string;
  zone: string;
  owner: string;
  settings: ZoneSettings;
  hsts: Hsts;
  dnssec: 'active' | 'disabled';
  firewall: FirewallRuleSpec[];
  rateLimit: RateLimitSpec;
  pagesDevRedirect: PagesDevRedirect;
  pages: { project: string; previewAccess: boolean; previewPolicy: 'service-auth-only' };
  schemaValidation: SchemaValidationSpec;
  turnstile: { domains: string[] };
}

// --- the v4 API, as read ----------------------------------------------------

export interface ApiErrorEntry {
  code?: number;
  message?: string;
}

export interface ApiPayload<T> {
  success?: boolean;
  errors?: ApiErrorEntry[];
  result?: T;
  result_info?: { total_pages?: number };
}

export interface Zone {
  id: string;
  account: { id: string };
}

export interface Setting {
  id: string;
  value: unknown;
  editable?: boolean;
}

// A ruleset rule: the fields this repo sets. Live rules also carry an id.
export interface Rule {
  ref?: string;
  description?: string;
  expression?: string;
  action?: string;
  enabled?: boolean;
  ratelimit?: {
    characteristics: string[];
    period: number;
    requests_per_period: number;
    mitigation_timeout: number;
  };
  action_parameters?: unknown;
}

export type OwnedRule = Rule & { ref: string };
export type LiveRule = Rule & { id: string };

export interface Ruleset {
  id: string;
  rules?: LiveRule[];
}

export interface RulesList {
  id: string;
  name: string;
  kind: string;
}

export interface Operation {
  operation_id: string;
  host: string;
  method: string;
  endpoint: string;
}

export interface ApiSchema {
  schema_id: string;
  name: string;
  source: string;
  validation_enabled?: boolean;
}

export interface ValidationSettings {
  validation_default_mitigation_action?: string;
  validation_override_mitigation_action?: string | null;
}

// An Access policy as the apps list embeds it. decision non_identity is
// Service Auth; include rules are one-key objects (email, service_token, ...).
export interface AccessPolicy {
  name?: string;
  decision?: string;
  include?: Record<string, unknown>[];
}

export interface AccessApp {
  domain?: string;
  self_hosted_domains?: string[];
  destinations?: { uri?: string }[];
  policies?: AccessPolicy[];
}

export interface PagesProject {
  deployment_configs?: Partial<Record<'production' | 'preview', { compatibility_date?: string }>>;
}

export interface Widget {
  sitekey: string;
  domains?: string[];
  [field: string]: unknown;
}

export interface LiveState {
  settings: Record<string, Setting | null | undefined>;
  dnssec: { status?: string } | null;
  firewall: Ruleset | null;
  ratelimit: Ruleset | null;
  redirect: Ruleset | null;
  list: RulesList | null;
  listItems: { redirect?: Record<string, unknown> }[];
  project: PagesProject | null;
  accessApps: AccessApp[];
  schemas: ApiSchema[];
  validationSettings: ValidationSettings | null;
  operation: Operation | null;
  operationSettings: { mitigation_action?: string } | null;
  widgets: Widget[];
}

// --- the plan ----------------------------------------------------------------

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

// A call to make, or a `use` step that binds an existing id and makes none.
export interface Call {
  method: Method;
  path: string;
  body?: unknown;
  saveAs?: Record<string, string>;
  awaitBulk?: boolean;
}

export type Step = Call | { use: Record<string, string> };

// ok | drift (apply fixes it) | manual (a person must) | unavailable (the API
// does not expose it here; reported, not counted).
export type ItemStatus = 'ok' | 'drift' | 'manual' | 'unavailable';

export interface Item {
  area: string;
  name: string;
  want: string;
  have: string;
  status: ItemStatus;
  steps: Step[];
  note: string;
}
