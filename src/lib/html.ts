import { htmlToHast, type HastNode } from 'satteri';

// Text placed in HTML markup, as element content or a quoted attribute value.
const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (char) => ENTITIES[char] ?? char);

// Readers for a built page. The hast parse follows the HTML spec, so values
// come back with their character references decoded.
type Element = Extract<HastNode, { type: 'element' }>;

export const parseHtml = (html: string): HastNode => htmlToHast(html);

function* elements(node: HastNode): Generator<Element> {
  if (node.type === 'element') yield node;
  if ('children' in node) for (const child of node.children) yield* elements(child);
}

const find = (doc: HastNode, test: (element: Element) => boolean): Element | undefined => elements(doc).find(test);

// Every element with this tag name, in document order.
export const elementsNamed = (doc: HastNode, tagName: string): Element[] =>
  elements(doc)
    .filter((el) => el.tagName === tagName)
    .toArray();

// The text of a node and everything under it, as the DOM's textContent.
export const textContent = (node: HastNode): string => (node.type === 'text' ? node.value : 'children' in node ? node.children.map(textContent).join('') : '');

// A `<meta>` keyed by `name` (description, robots) or `property` (og:*).
export function metaContent(doc: HastNode, key: string): string | undefined {
  const meta = find(doc, (el) => el.tagName === 'meta' && (el.properties.name === key || el.properties.property === key));
  const content = meta?.properties.content;
  return typeof content === 'string' ? content : undefined;
}

export function linkHref(doc: HastNode, rel: string): string | undefined {
  const link = find(doc, (el) => {
    const rels = el.properties.rel;
    return el.tagName === 'link' && Array.isArray(rels) && rels.includes(rel);
  });
  const href = link?.properties.href;
  return typeof href === 'string' ? href : undefined;
}

export function title(doc: HastNode): string | undefined {
  const element = find(doc, (el) => el.tagName === 'title');
  return element && textContent(element).trim();
}
