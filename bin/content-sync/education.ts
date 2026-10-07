// /education/ joins the resume canonical's EDUCATION section (institution identity) with
// `severino-vault-mcp export education` (coursework). A course renders once it is active or
// completed and has `## Site` bullets; the page marked `education_index: true` is the shell and gates the tree.
import { stringifyFrontmatter } from '../../src/lib/frontmatter.ts';
import { DOCUMENT_FILE } from '../../src/lib/snapshot.ts';
import { orgRow, renderDocumentRows, roleRow, type Grammar, type Org, type Role } from './documents.ts';

// `severino-vault-mcp export education`: the fields this join reads.
interface Course {
  code: string;
  title: string;
  term: string;
  status: string;
  site_bullets?: string;
}

interface Institution {
  institution: string;
  slug: string;
  description: string;
  courses: Course[];
}

export interface EducationDataset {
  institutions: Institution[];
}

interface EducationOrg extends Org {
  degree?: Role;
}

// A page relative to the pages root, rendered with its frontmatter.
export interface RenderedPage {
  page: string;
  content: string;
}

export interface EducationInput {
  grammar: Grammar;
  shell: { data: Record<string, unknown>; content: string };
  resume: { content: string };
  dataset: EducationDataset;
  projectPage: (data: Record<string, unknown>) => Record<string, unknown>;
}

const SITE_COURSE_STATUSES = new Set(['active', 'completed']);

const publishableCourses = (institution: Institution): Course[] =>
  institution.courses.filter((course) => SITE_COURSE_STATUSES.has(course.status) && course.site_bullets);

// The resume canonical's EDUCATION orgs with their degree row, in order.
function resumeEducationOrgs(grammar: Grammar, content: string): EducationOrg[] {
  const orgs: EducationOrg[] = [];
  let inEducation = false;
  for (const line of grammar.linesForSite(content.split('\n'))) {
    if (/^## /.test(line)) {
      inEducation = /^## education$/i.test(line.trim());
      continue;
    }
    if (!inEducation) continue;
    const org = grammar.matchOrg(line);
    if (org) {
      orgs.push({ ...org });
      continue;
    }
    const role = grammar.matchRole(line);
    const last = orgs.at(-1);
    if (role && last && !last.degree) last.degree = role;
  }
  return orgs;
}

function courseRow(course: Course): string {
  const code = course.code.replace(/(\d)/, ' $1');
  const dates = course.status === 'active' ? `${course.term} · in progress` : course.term;
  return `**${code} — ${course.title} (${dates})**`;
}

function courseProgress(courses: readonly Course[]): string {
  const completed = courses.filter((course) => course.status === 'completed').length;
  const active = courses.filter((course) => course.status === 'active').length;
  return [
    completed > 0 ? `${completed} course${completed === 1 ? '' : 's'} completed` : '',
    active > 0 ? `${active} in progress` : '',
  ].filter(Boolean).join(' · ');
}

// Pure: the education pages as { page, content } (page relative to the pages
// root) plus the org-name → URL links the resume headings should carry.
// projectPage maps raw page frontmatter to its public projection.
export function buildEducation({ grammar, shell, resume, dataset, projectPage }: EducationInput): { pages: RenderedPage[]; links: Map<string, string> } {
  const vaultInstitutions = new Map(dataset.institutions.map((entry) => [entry.institution, entry]));
  const links = new Map<string, string>();
  const pages: RenderedPage[] = [];
  // The organization rows are h3s (as on the resume), so a hidden h2 keeps the outline unbroken under the h1.
  const rows = [shell.content.trim(), '<h2 class="visually-hidden">Institutions</h2>'].filter(Boolean);

  for (const org of resumeEducationOrgs(grammar, resume.content)) {
    const institution = vaultInstitutions.get(org.name);
    if (!institution) continue;
    vaultInstitutions.delete(org.name);
    const href = `/education/${institution.slug}/`;

    const courses = publishableCourses(institution);
    const detailBody = courses.map((course) => `${courseRow(course)}\n\n${course.site_bullets}`).join('\n\n');
    pages.push({
      page: `education/${institution.slug}/${DOCUMENT_FILE}`,
      content: stringifyFrontmatter(
        renderDocumentRows(grammar, detailBody),
        projectPage({
          title: org.name,
          description: institution.description,
          intro: [org.degree?.title, org.location, org.degree?.dates].filter(Boolean).join(' · '),
          path: href,
          published: shell.data.published,
        }),
      ),
    });
    links.set(org.name, href);

    const progress = courseProgress(courses);
    rows.push(
      orgRow(org, { href }),
      ...(org.degree ? [roleRow(org.degree)] : []),
      ...(progress ? [`- ${progress}`] : []),
    );
  }

  if (vaultInstitutions.size > 0) {
    throw new Error(
      `Education vault institution(s) missing from the resume canonical's EDUCATION section: ${[...vaultInstitutions.keys()].join(', ')}`,
    );
  }

  pages.push({ page: `education/${DOCUMENT_FILE}`, content: stringifyFrontmatter(rows.join('\n\n'), projectPage(shell.data)) });
  return { pages, links };
}
