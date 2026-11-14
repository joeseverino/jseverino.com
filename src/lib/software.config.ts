// The Software tab's curation, the one part of it written by hand. Each repo's
// description, language and last push come from GitHub and are edited on the
// repo; what GitHub cannot say (which repos lead, which to leave out, the
// writeup and package each links to, which run self-hosted) is set here. Forks
// never show, and an archived repo shows marked Archived.

import { SITE } from './site-config.ts';

// Repos to hide (meta, archived predecessors, or not portfolio-worthy).
export const SKIP = new Set<string>(['arp-spoofing-mininet-lab', 'phptest', 'jseverino.com-legacy', SITE.github, 'severino-brand']);

// Repos rendered as rich featured cards, in this order; the rest sort after, by title.
export const FEATURED: readonly string[] = ['severino-vault-mcp', 'branding-engine', 'sitedrift', 'tools', 'cordon'];

// repo -> writeup slug for the "Read the writeup" cross-link.
export const WRITEUPS: Record<string, string> = {
  'severino-vault-mcp': 'building-a-custom-mcp-layer',
  'jseverino.com': 'from-wordpress-to-astro',
  'study-quiz': 'building-study-quiz',
  'severino-labs-security-layer': 'securing-my-wordpress-site',
  'football-score-simulator': 'oop-football-score-simulator',
  'math-quiz-game': 'math-quiz-game',
};

export type PackageConfig = {
  registry: 'pypi' | 'npm';
  name: string;
  install: string;
  url: string;
};

// repo -> published package (GitHub doesn't know about PyPI/npm).
export const PACKAGES: Record<string, PackageConfig> = {
  'branding-engine': {
    registry: 'npm',
    name: 'branding-engine',
    install: 'npm i branding-engine',
    url: 'https://www.npmjs.com/package/branding-engine',
  },
  sitedrift: {
    registry: 'npm',
    name: 'sitedrift',
    install: 'npm i sitedrift',
    url: 'https://www.npmjs.com/package/sitedrift',
  },
};

// Repos whose deployed instance is private/self-hosted (repo is still public).
export const SELF_HOSTED = new Set<string>(['severino-hq']);
