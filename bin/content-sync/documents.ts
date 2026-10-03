// The shared document grammar (schools/orgs, courses/roles, bullets, certs,
// project meta) rendered to classed HTML rows. /resume/, any page marked
// `document_layout: true`, and the education pages all render through here:
// one row renderer, one CSS block. The line grammar and tenure math live in
// resume-engine's lib/grammar.ts, which the PDF reads too.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export interface Org {
  name: string;
  location: string;
}

export interface Role {
  title: string;
  dates: string;
}

// The surface of resume-engine's grammar module the site renders through.
export interface Grammar {
  linesForSite(lines: string[]): string[];
  matchOrg(line: string): Org | null;
  matchRole(line: string): Role | null;
  matchCert(text: string): { name: string; url: string; date: string; issuer: string } | null;
  matchProjectMeta(line: string): { label: string; href: string; date: string } | null;
  orgRoleDates(lines: string[], orgIndex: number): string[];
  tenureSpan(dates: string[]): string;
}

export async function loadGrammar(resumeEngineRoot: string): Promise<Grammar> {
  const grammarPath = path.join(resumeEngineRoot, 'lib', 'grammar.ts');
  if (!fs.existsSync(grammarPath)) {
    throw new Error(`resume grammar not found: ${grammarPath} (clone resume-engine or set RESUME_ENGINE_DIR)`);
  }
  // A module outside the repo, loaded by path; Grammar is the contract it is held to.
  return (await import(pathToFileURL(grammarPath).href)) as Grammar;
}

// An org heading. A multi-role org carries its summarized tenure span with the
// location tucked under it; `href` links the name (resume orgs to their
// /education/ page).
export function orgRow(org: Org, { tenure, href }: { tenure?: string | undefined; href?: string | undefined } = {}): string {
  const meta = tenure
    ? `<span class="resume-org-meta"><span class="resume-dates">${tenure}</span><span class="resume-loc">${org.location}</span></span>`
    : `<span class="resume-loc">${org.location}</span>`;
  const name = href ? `<a href="${href}">${org.name}</a>` : org.name;
  return `<h3 class="resume-org"><span>${name}</span>${meta}</h3>`;
}

export const roleRow = (role: Role): string =>
  `<p class="resume-role"><strong>${role.title}</strong><span class="resume-dates">${role.dates}</span></p>`;

export function lineRow(grammar: Grammar, line: string): string {
  const role = grammar.matchRole(line);
  if (role) return roleRow(role);

  const cert = line.startsWith('- ') ? grammar.matchCert(line.slice(2)) : null;
  if (cert) {
    return `<p class="resume-cert"><a href="${cert.url}">${cert.name}</a><span class="resume-issuer">${cert.issuer}</span><span class="resume-dates">${cert.date}</span></p>`;
  }

  const projectMeta = grammar.matchProjectMeta(line);
  if (projectMeta) {
    return `<p class="resume-projmeta"><a href="${projectMeta.href}">${projectMeta.label}</a><span class="resume-dates">${projectMeta.date}</span></p>`;
  }

  return line;
}

// links: Map of org name to the page its heading should link to.
export function renderDocumentRows(grammar: Grammar, rawContent: string, links: ReadonlyMap<string, string> = new Map()): string {
  const lines = grammar.linesForSite(rawContent.split('\n'));
  return lines
    .map((line, index) => {
      const org = grammar.matchOrg(line);
      if (!org) return lineRow(grammar, line);
      const dates = grammar.orgRoleDates(lines, index);
      return orgRow(org, {
        tenure: dates.length > 1 ? grammar.tenureSpan(dates) : undefined,
        href: links.get(org.name),
      });
    })
    .join('\n');
}
