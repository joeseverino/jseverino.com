// Instance identity, dependency-free so the site and bin/ scripts can both import it.
// A new site from this blueprint changes these plus the residue in docs/Blueprint-Setup.md.
export interface SiteIdentity {
  domain: string;
  owner: string;
  github: string;
  d1: string;
  // The Worker's name, as wrangler.jsonc declares it.
  worker: string;
  // The account's workers.dev subdomain, which carries the Worker's preview URLs.
  workersSubdomain: string;
  focus: readonly string[];
}

export const SITE: SiteIdentity = {
  domain: 'jseverino.com',
  owner: 'Joe Severino',
  github: 'joeseverino',
  d1: 'jseverino-contact',
  worker: 'jseverino',
  workersSubdomain: 'severino',
  focus: ['Cybersecurity', 'Networking', 'AI'],
};

export const SITE_ORIGIN = `https://${SITE.domain}`;
// Where browsers send CSP violation reports: src/pages/api/csp-report.ts.
export const cspReportPath = '/api/csp-report';
export const cspReportUri = `${SITE_ORIGIN}${cspReportPath}`;

// The branch every PR targets and deploys from, and the prefix `site publish` gives content branches.
export const DEFAULT_BRANCH = 'main';
export const CONTENT_BRANCH_PREFIX = 'content/';
// Every preview URL of the Worker is <label><suffix>: the label is a branch's alias or the first
// eight characters of a version ID.
export const PREVIEW_HOST_SUFFIX = `-${SITE.worker}.${SITE.workersSubdomain}.workers.dev`;
export const previewOrigin = (label: string): string => `https://${label}${PREVIEW_HOST_SUFFIX}`;
// The check-run the deploy workflow writes on each commit it deploys: a pull request's preview, or main's
// production deploy. main's ruleset requires it, and `site land` and deploy-verify wait on it.
export const DEPLOY_CHECK = 'deploy';

export const writeupPath = (slug: string): string => `/portfolio/${slug}/`;
export const writeupUrl = (slug: string, origin = SITE_ORIGIN): string => `${origin}${writeupPath(slug)}`;
export const tagPath = (slug: string): string => `/tag/${slug}/`;

// Off: the zone injects the beacon. On: the layout emits it; switch the zone's Web Analytics
// site to "Enable with JS Snippet installation" in the same release, or pages carry two beacons.
// Steps in docs/Cloudflare.md.
export const WEB_ANALYTICS: { emitBeacon: boolean; token: string } = { emitBeacon: false, token: '' };
export const SITE_REPOSITORY = `${SITE.github}/${SITE.domain}`;
