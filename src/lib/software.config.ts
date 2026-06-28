// Curation for the Software tab. This is the ONLY hand-maintained input: which
// repos show, their prominence/order, their writeup cross-links, and the
// non-GitHub facts GitHub can't know (PyPI/npm packages, self-hosted). Repo
// descriptions, language, and last-pushed are derived from GitHub — edit copy on
// the repo, not here. Forks and archived repos are excluded automatically.

/** Repos to hide (meta, archived predecessors, or not portfolio-worthy). */
export const SKIP = new Set<string>([
  'arp-spoofing-mininet-lab',
  'phptest',
  'AdGuardHome_DNSQueryAnalyzer',
  'jseverino.com-legacy',
  'joeseverino',
  'severino-brand',
]);

/** Repos rendered as rich featured cards (vs the compact list). */
export const FEATURED = new Set<string>([
  'vault-engine',
  'branding-engine',
  'sitedrift',
  'severino-vault-mcp',
  'tools',
  'cordon',
]);

/** Explicit ordering (lower = earlier). Unlisted repos sort after, by recency. */
export const ORDER: Record<string, number> = {
  'vault-engine': 1,
  'branding-engine': 2,
  'sitedrift': 3,
  'severino-vault-mcp': 4,
  'tools': 5,
  'cordon': 6,
};

/** repo -> writeup slug for the "Read the writeup" cross-link. */
export const WRITEUPS: Record<string, string> = {
  'vault-engine': 'building-a-custom-mcp-layer',
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
  'vault-engine': {
    registry: 'pypi',
    name: 'severino-vault-engine',
    install: 'pip install severino-vault-engine',
    url: 'https://pypi.org/project/severino-vault-engine/',
  },
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
