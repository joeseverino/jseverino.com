// gray-matter's byte semantics: `---` opens on line one, the first `\n---` closes, one line break after is dropped.
import { dump, load } from 'js-yaml';

const FENCE = /^---(?!-)[^\r\n]*([\s\S]*?)(?:\n---\r?\n?|$)/;
export type FrontmatterData = Record<string, unknown>;

export interface ParsedFrontmatter {
  data: FrontmatterData;
  content: string;
}

const stripBom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

export function parseFrontmatter(markdown: string): ParsedFrontmatter {
  const text = stripBom(markdown);
  const match = FENCE.exec(text);
  if (!match) return { data: {}, content: text };
  return { data: (load(match[1] ?? '') ?? {}) as FrontmatterData, content: text.slice(match[0].length) };
}

export function stringifyFrontmatter(markdown: string, data: FrontmatterData): string {
  const text = stripBom(markdown);
  const body = text.endsWith('\n') ? text : `${text}\n`;
  const yaml = dump(data).trim();
  return yaml === '{}' ? body : `---\n${yaml}\n---\n${body}`;
}
