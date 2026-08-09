import { SITE } from './site-config.mjs';

// Typed, Astro-facing site identity. Bare instance primitives live in site-config.mjs
// (importable by node scripts too); everything here is derived from them or is
// editorial chrome that used to live in the vault-synced src/content/site.md.
const url = `https://${SITE.domain}`;
const focusLabel = SITE.focus.join(' • ');
const summary =
  'Joe Severino is a Technical Solutions Engineer at World Wide Technology focused on infrastructure, detection engineering, and secure operations.';

export const site = {
  name: SITE.owner,
  url,
  repoUrl: `https://github.com/${SITE.github}/${SITE.domain}`,
  defaultTitle: `${SITE.owner} | ${SITE.focus.slice(0, -1).join(', ')}, and ${SITE.focus.at(-1)}`,
  defaultDescription: summary,
  defaultOgImage: '/assets/og/og-default.png',
  defaultOgImageWidth: 1200,
  defaultOgImageHeight: 630,
  jobTitle: 'Technical Solutions Engineer',
  employer: 'World Wide Technology',
  summary,
  focusLabel,
  skills: [...SITE.focus, 'Network Security', 'Infrastructure', 'Detection Engineering', 'Homelab', 'Linux'],
  socialLinks: [
    { label: 'LinkedIn', href: 'https://linkedin.com/in/joeseverino/' },
    { label: 'GitHub', href: `https://github.com/${SITE.github}` },
  ],
  navItems: [
    { label: 'About', href: '/about/' },
    { label: 'Portfolio', href: '/portfolio/' },
    { label: 'Resume', href: '/resume/' },
    { label: 'Contact', href: '/contact/' },
  ],
};
