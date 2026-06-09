// Canonical instance identity — the single source of truth for the values that
// make this repo "jseverino.com" rather than the framework underneath it.
// Plain .mjs so both the Astro site and the node scripts in bin/ can import it
// (the same reason brand.mjs is .mjs). For a new site built from this blueprint,
// these four fields plus the residue listed in docs/Blueprint-Setup.md are the
// only things that change.
//
// Consumers:
//   - src/lib/site.ts              → derives url, repoUrl, titles, chrome
//   - bin/deploy-verify.mjs        → production URL probes
//   - bin/seo-preview.mjs          → canonical/OG base URL
//   - tests/audits/check-seo.mjs   → expected canonical host
//   - functions/__sitedrift/*      → fixed LIVE proxy origin
//   - astro.config.mjs             → site URL
export const SITE = {
  domain: 'jseverino.com',
  owner: 'Joe Severino',
  github: 'joeseverino',
  d1: 'jseverino-contact',
};
