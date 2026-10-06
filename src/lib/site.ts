import { SITE, SITE_ORIGIN, SITE_REPOSITORY } from './site-config.ts';

// Typed, Astro-facing site identity. Bare instance primitives live in site-config.ts
// (importable by node scripts too); everything here is derived from them or is
// editorial chrome owned by the repo.
const focusLabel = SITE.focus.join(' • ');
const summary =
  'Joe Severino is a Technical Solutions Engineer at World Wide Technology focused on infrastructure, detection engineering, and secure operations.';

export const site = {
  name: SITE.owner,
  url: SITE_ORIGIN,
  repoUrl: `https://github.com/${SITE_REPOSITORY}`,
  defaultTitle: `${SITE.owner} | ${SITE.focus.slice(0, -1).join(', ')}, and ${SITE.focus.at(-1)}`,
  defaultDescription: summary,
  defaultOgImage: '/assets/og/og-default.jpg',
  defaultOgImageWidth: 1200,
  defaultOgImageHeight: 630,
  // Rendered from the resume canonical by resume-engine; the resume page links it.
  resumePdf: '/assets/docs/joseph-severino-resume.pdf',
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
