// Curation for the Software tab. This is the ONLY hand-maintained input: which
// repos show, their prominence/order, their writeup cross-links, and the
// non-GitHub facts GitHub can't know (PyPI/npm packages, self-hosted). Repo
// descriptions, language, and last-pushed come from GitHub; edit that copy on
// the repo. Forks are excluded automatically; archived repos stay, labelled Archived.

import { SITE } from './site-config.ts';

/** Repos to hide (meta, archived predecessors, or not portfolio-worthy). */
export const SKIP = new Set<string>([
  'arp-spoofing-mininet-lab',
  'phptest',
  'AdGuardHome_DNSQueryAnalyzer',
  'jseverino.com-legacy',
  SITE.github,
  'severino-brand',
]);

/** Repos rendered as rich featured cards, in this order; the rest sort after, by title. */
export const FEATURED: readonly string[] = [
  'severino-vault-mcp',
  'branding-engine',
  'sitedrift',
  'tools',
  'cordon',
];

/** repo -> writeup slug for the "Read the writeup" cross-link. */
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

/** repo -> published package (GitHub doesn't know about PyPI/npm). */
export const PACKAGES: Record<string, PackageConfig> = {
  'branding-engine': {
    registry: 'npm',
    name: 'branding-engine',
    install: 'npm i branding-engine',
    url: 'https://www.npmjs.com/package/branding-engine',
  },
  'sitedrift': {
    registry: 'npm',
    name: 'sitedrift',
    install: 'npm i sitedrift',
    url: 'https://www.npmjs.com/package/sitedrift',
  },
};

/** Repos whose deployed instance is private/self-hosted (repo is still public). */
export const SELF_HOSTED = new Set<string>(['severino-hq']);
