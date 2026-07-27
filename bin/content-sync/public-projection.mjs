import { projectFrontmatter } from '../../src/lib/content-contract.mjs';

export function createPublicProjection({ syncManifest, today }) {
  return {
    page(data) { return projectFrontmatter('pages', data); },
    writeup(data, contentHash, slug) {
      const previousHash = syncManifest[slug];
      const changed = typeof previousHash === 'string' && previousHash !== contentHash;
      const lastReviewed = changed ? today : data.last_reviewed || data.published_at || today;
      syncManifest[slug] = contentHash;
      return projectFrontmatter('writeups', { ...data, last_reviewed: lastReviewed });
    },
  };
}

export function rewritePageAssetPaths(markdown, slug) {
  return markdown
    .replaceAll('./images/', `/assets/pages/${slug}/images/`)
    .replaceAll('](images/', `](/assets/pages/${slug}/images/`)
    .replaceAll('src="./images/', `src="/assets/pages/${slug}/images/`)
    .replaceAll('src="images/', `src="/assets/pages/${slug}/images/`);
}

export function rewriteWriteupAssetPaths(markdown, slug) {
  return markdown
    .replaceAll('./images/', `/assets/writeups/${slug}/images/`)
    .replaceAll('](images/', `](/assets/writeups/${slug}/images/`);
}

function stripHtmlTags(value) {
  let current = value;
  let previous;
  do { previous = current; current = current.replace(/<[^>]+>/g, ''); } while (current !== previous);
  return current;
}

export function normalizeDescription(text) {
  const withoutMarkdownLinks = text
    .replace(/\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '');
  return stripHtmlTags(withoutMarkdownLinks)
    .replace(/\\$/gm, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ').trim();
}

export function stripRepeatedDescription(markdown, description) {
  if (typeof description !== 'string' || !description.trim()) return markdown;
  const expected = normalizeDescription(description);
  const lines = markdown.split(/\r?\n/);
  const output = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    const candidateStart =
      (trimmed.startsWith('>') || trimmed.startsWith('[') || /^[A-Z0-9]/.test(trimmed)) &&
      output.some((previous) => /^#\s+/.test(previous.trim()));
    if (!candidateStart) { output.push(line); index += 1; continue; }
    const start = index;
    const candidate = [];
    while (index < lines.length && lines[index].trim() !== '') candidate.push(lines[index++]);
    const text = normalizeDescription(candidate.join(' ').replace(/^>\s?/gm, ''));
    if (text === expected) { while (index < lines.length && lines[index].trim() === '') index += 1; continue; }
    output.push(...lines.slice(start, index));
  }
  return `${output.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}
