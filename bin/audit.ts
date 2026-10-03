#!/usr/bin/env node
// npm audit with an expiring allowlist: fails on any high or critical advisory
// that .github/audit-allowlist.json does not accept, or accepts past its
// reviewBy date. Reads the lockfile; no install needed.
//
//   node bin/audit.ts [--json]
import { cli } from './lib/args.ts';
import { run } from './lib/run.ts';
import { fromRoot, siteRoot } from '../src/lib/site-root.ts';
import { readJson } from '../src/lib/json.ts';
import { isoDate } from '../src/lib/dates.ts';

const json = cli({ usage: 'usage: node bin/audit.ts [--json]', options: { json: { type: 'boolean', default: false } } }).values.json;
const BLOCKING = new Set(['high', 'critical']);
const today = isoDate();

interface AllowlistEntry {
  ghsa: string;
  package: string;
  reviewBy: string;
}

// npm audit --json: the fields read here.
interface AuditVia {
  name: string;
  severity: string;
  title: string;
  url?: string;
  source?: number;
}
interface AuditReport {
  vulnerabilities?: Record<string, { via: (string | AuditVia)[] }>;
}

interface Advisory {
  ghsa: string;
  package: string;
  severity: string;
  title: string;
  url: string | undefined;
}

export interface AuditFinding extends Advisory {
  status: 'unaccepted' | 'expired' | 'accepted';
  reviewBy: string | null;
}

// The --json document.
export interface AuditDocument {
  ok: boolean;
  findings: AuditFinding[];
  stale: AllowlistEntry[];
}

const { advisories: allowlist } = readJson<{ advisories: AllowlistEntry[] }>(fromRoot('.github/audit-allowlist.json'));
const accepted = new Map(allowlist.map((entry) => [`${entry.ghsa}:${entry.package}`, entry]));

// npm audit exits 1 whenever it finds anything; the report is on stdout either way.
const result = await run('npm', ['audit', '--json'], { cwd: siteRoot, timeout: 2 * 60_000 });
let report: AuditReport;
try {
  report = JSON.parse(result.stdout) as AuditReport;
} catch {
  console.error(`npm audit did not produce a report:\n${result.output.trim()}`);
  process.exit(1);
}

// Advisory objects (not the transitive "via" names) with their GHSA id.
const found = new Map<string, Advisory>();
for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
  for (const via of vulnerability.via) {
    if (typeof via !== 'object' || !BLOCKING.has(via.severity)) continue;
    const ghsa = via.url?.match(/GHSA-[\w-]+/)?.[0] ?? `advisory-${via.source}`;
    found.set(`${ghsa}:${via.name}`, { ghsa, package: via.name, severity: via.severity, title: via.title, url: via.url });
  }
}

const findings = [...found.values()].map((advisory): AuditFinding => {
  const entry = accepted.get(`${advisory.ghsa}:${advisory.package}`);
  const status = !entry ? 'unaccepted' : entry.reviewBy < today ? 'expired' : 'accepted';
  return { ...advisory, status, reviewBy: entry?.reviewBy ?? null };
});
const stale = allowlist.filter((entry) => !found.has(`${entry.ghsa}:${entry.package}`));
const failing = findings.filter((finding) => finding.status !== 'accepted');

if (json) {
  const document: AuditDocument = { ok: failing.length === 0, findings, stale };
  console.log(JSON.stringify(document, null, 2));
} else {
  for (const finding of findings) {
    const note = finding.status === 'accepted' ? `accepted until ${finding.reviewBy}` : finding.status === 'expired' ? `EXPIRED ${finding.reviewBy}: review it` : 'NOT ACCEPTED';
    console.log(`${finding.severity.padEnd(9)}${finding.ghsa} ${finding.package}: ${finding.title} (${note})`);
  }
  for (const entry of stale) console.log(`stale    ${entry.ghsa} ${entry.package} no longer applies; remove it from .github/audit-allowlist.json`);
  if (failing.length === 0) console.log(`ok       ${findings.length} high/critical advisories, all accepted and current`);
  else console.error(`failed: ${failing.length} high/critical advisories need a fix or a reviewed allowlist entry`);
}
process.exit(failing.length === 0 ? 0 : 1);
