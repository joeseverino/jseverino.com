// Instance identity: the values that make this repo jseverino.com. Dependency-free
// so the Astro site and the scripts in bin/ can both import it (as with brand.ts).
// A new site built from this blueprint changes these fields plus the residue
// listed in docs/Blueprint-Setup.md.
//
// Consumers:
//   - src/lib/site.ts              → derives url, repoUrl, titles, chrome
//   - bin/deploy-verify.ts        → production URL probes
//   - bin/seo-preview.ts          → canonical/OG base URL
//   - tests/audits/check-seo.ts   → expected canonical host
//   - functions/__sitedrift/*      → fixed LIVE proxy origin
//   - astro.config.ts             → site URL
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
// The project's pages.dev host; each deployment is <hash>.<host>.
export const PAGES_HOST = `${SITE.pagesProject}.pages.dev`;

// Where a writeup lives, the one route every caller builds.
export const writeupPath = (slug: string): string => `/portfolio/${slug}/`;
export const writeupUrl = (slug: string, origin = SITE_ORIGIN): string => `${origin}${writeupPath(slug)}`;

// Cloudflare Web Analytics. Off: the zone injects the beacon into every HTML
// response. On: the layout emits it with the nonce placeholder, so the repo
// owns the markup; set the site token (public, it ships in every page either
// way) and switch the zone's Web Analytics site to "Enable with JS Snippet
// installation" in the same release, or pages carry two beacons.
// docs/Cloudflare.md has the steps.
export const WEB_ANALYTICS: { emitBeacon: boolean; token: string } = { emitBeacon: false, token: '' };
// owner/name on GitHub, as the gh CLI and the REST API spell it.
export const SITE_REPOSITORY = `${SITE.github}/${SITE.domain}`;
