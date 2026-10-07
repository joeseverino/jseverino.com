// Instance identity, dependency-free so the site and bin/ scripts can both import it.
// A new site from this blueprint changes these plus the residue in docs/Blueprint-Setup.md.
export interface SiteIdentity {
  domain: string;
  owner: string;
  github: string;
  d1: string;
  // The Cloudflare Pages project; cloudflare/zone.json names the same one.
  pagesProject: string;
  focus: readonly string[];
}

export const SITE: SiteIdentity = {
  domain: 'jseverino.com',
  owner: 'Joe Severino',
  github: 'joeseverino',
  d1: 'jseverino-contact',
  pagesProject: 'jseverino',
  focus: ['Cybersecurity', 'Networking', 'AI'],
};

export const SITE_ORIGIN = `https://${SITE.domain}`;

// The branch every PR targets and deploys from, and the prefix `site publish` gives content branches.
export const DEFAULT_BRANCH = 'main';
export const CONTENT_BRANCH_PREFIX = 'content/';
// The project's pages.dev host; each deployment is <hash>.<host>.
export const PAGES_HOST = `${SITE.pagesProject}.pages.dev`;

export const writeupPath = (slug: string): string => `/portfolio/${slug}/`;
export const writeupUrl = (slug: string, origin = SITE_ORIGIN): string => `${origin}${writeupPath(slug)}`;
export const tagPath = (slug: string): string => `/tag/${slug}/`;

// Off: the zone injects the beacon. On: the layout emits it; switch the zone's Web Analytics
// site to "Enable with JS Snippet installation" in the same release, or pages carry two beacons.
// Steps in docs/Cloudflare.md.
export const WEB_ANALYTICS: { emitBeacon: boolean; token: string } = { emitBeacon: false, token: '' };
export const SITE_REPOSITORY = `${SITE.github}/${SITE.domain}`;
