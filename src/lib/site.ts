import { SITE } from './site-config.mjs';

// Typed, Astro-facing site identity. Bare instance primitives live in site-config.mjs
// (importable by node scripts too); everything here is derived from them or is
// editorial chrome that used to live in the vault-synced src/content/site.md.
const url = `https://${SITE.domain}`;
const summary =
  'Joe Severino is a cybersecurity professional and Delivery Operations Analyst focused on infrastructure, detection engineering, and secure operations.';

export const site = {
  name: SITE.owner,
  url,
  repoUrl: `https://github.com/${SITE.github}/${SITE.domain}`,
  defaultTitle: `${SITE.owner} | Cybersecurity and Networking`,
  defaultDescription: summary,
  defaultOgImage: '/assets/og/og-default.png',
  defaultOgImageWidth: 1200,
  defaultOgImageHeight: 630,
  jobTitle: 'Delivery Operations Analyst',
  summary,
  skills: ['Cybersecurity', 'Network Security', 'Infrastructure', 'Detection Engineering', 'Homelab', 'Linux'],
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
