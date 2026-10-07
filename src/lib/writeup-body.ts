// Pure string transforms shared by the sync and anything that previews a writeup.

// The page renders title, lede, and cover from frontmatter, so the body's H1, opening blockquote, and leading image go.
export function stripArticleChrome(markdown: string): string {
  const body = markdown
    .trimStart()
    .replace(/^# .+(?:\r?\n)+/, '')
    .replace(/^>\s+.+(?:\r?\n)+/, '')
    .replace(/^!\[[^\]]*\]\([^)]+\)(?:\r?\n)+/, '')
    .trim();
  return `${body}\n`;
}

function stripHtmlTags(value: string): string {
  let current = value;
  let previous: string;
  do { previous = current; current = current.replace(/<[^>]+>/g, ''); } while (current !== previous);
  return current;
}

export function normalizeDescription(text: string): string {
  const withoutMarkdownLinks = text
    .replace(/\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '');
  return stripHtmlTags(withoutMarkdownLinks)
    .replace(/\\$/gm, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ').trim();
}

export function stripRepeatedDescription(markdown: string, description: unknown): string {
  if (typeof description !== 'string' || !description.trim()) return markdown;
  const expected = normalizeDescription(description);
  const lines = markdown.split(/\r?\n/);
  const output: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();
    const candidateStart =
      (trimmed.startsWith('>') || trimmed.startsWith('[') || /^[A-Z0-9]/.test(trimmed)) &&
      output.some((previous) => /^#\s+/.test(previous.trim()));
    if (!candidateStart) { output.push(line); index += 1; continue; }
    const start = index;
    const candidate: string[] = [];
    for (let line; (line = lines[index]) !== undefined && line.trim() !== ''; index += 1) candidate.push(line);
    const text = normalizeDescription(candidate.join(' ').replace(/^>\s?/gm, ''));
    if (text === expected) { while (lines[index]?.trim() === '') index += 1; continue; }
    output.push(...lines.slice(start, index));
  }
  return `${output.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}
