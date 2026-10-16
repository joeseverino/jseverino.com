// gray-matter's byte semantics: `---` opens on line one, the first `\n---` closes, one line break after is dropped.
import { CORE_SCHEMA, dump, loadAll, mergeTag, timestampTag } from 'js-yaml';

export const FRONTMATTER_SCHEMA = CORE_SCHEMA.withTags(mergeTag, timestampTag);

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
  const [data] = loadAll(match[1] ?? '', { schema: FRONTMATTER_SCHEMA });
  const content = text.slice(match[0].length);
  if (data === undefined || data === null) return { data: {}, content };
  if (typeof data !== 'object' || Array.isArray(data) || data instanceof Date) throw new Error('frontmatter must be a mapping');
  return { data: data as FrontmatterData, content };
}

export function stringifyFrontmatter(markdown: string, data: FrontmatterData): string {
  const text = stripBom(markdown);
  const body = text.endsWith('\n') ? text : `${text}\n`;
  const yaml = dump(data, { schema: FRONTMATTER_SCHEMA }).trim();
  return yaml === '{}' ? body : `---\n${yaml}\n---\n${body}`;
}
