import { CORE_SCHEMA, dump, loadAll, mergeTag, timestampTag } from 'js-yaml';

export const FRONTMATTER_SCHEMA = CORE_SCHEMA.withTags(mergeTag, timestampTag);

// Where a document's frontmatter sits, as offsets into the text given (a BOM counted).
export interface FrontmatterBlock {
  // From the opening line's break up to the closing fence's: the text gray-matter hands to YAML.
  yaml: string;
  yamlStart: number;
  contentStart: number;
  // false when no fence closes the block, which then runs to the end.
  closed: boolean;
}

const OPENING_LINE = /^\uFEFF?---(?!-)[^\r\n]*/;

// gray-matter's byte semantics: `---` opens on line one (after a BOM), the first `\n---` closes,
// one line break after is dropped. Every reader and writer of frontmatter finds it here.
export function frontmatterBlock(text: string): FrontmatterBlock | undefined {
  const yamlStart = OPENING_LINE.exec(text)?.[0].length;
  if (yamlStart === undefined) return undefined;
  const close = text.indexOf('\n---', yamlStart);
  if (close === -1) return { yaml: text.slice(yamlStart), yamlStart, contentStart: text.length, closed: false };
  let contentStart = close + 4;
  if (text[contentStart] === '\r') contentStart += 1;
  if (text[contentStart] === '\n') contentStart += 1;
  return { yaml: text.slice(yamlStart, close), yamlStart, contentStart, closed: true };
}

export type FrontmatterData = Record<string, unknown>;

export interface ParsedFrontmatter {
  data: FrontmatterData;
  content: string;
}

const stripBom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

export function parseFrontmatter(markdown: string): ParsedFrontmatter {
  const block = frontmatterBlock(markdown);
  if (!block) return { data: {}, content: stripBom(markdown) };
  const [data] = loadAll(block.yaml, { schema: FRONTMATTER_SCHEMA });
  const content = markdown.slice(block.contentStart);
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
