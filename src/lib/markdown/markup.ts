// HTML-level finishing: separator-delimited values in table cells (IPs, MACs)
// may wrap at their separators, a ```terminal fence renders as the terminal
// block, and every table sits in a scrollable figure. Wrapping is its own
// pass, after the cell edits, because a pass cannot move a node it also
// edited inside.
import { defineHastPlugin, type HastNode, type HastVisitorContext } from 'satteri';
import type { Element, ElementContent, Text } from 'hast';

const el = (tagName: string, className: string[] | undefined, children: ElementContent[]): Element => ({
  type: 'element',
  tagName,
  properties: className ? { className } : {},
  children,
});
const text = (value: string): Text => ({ type: 'text', value });

function ancestors(node: HastNode, ctx: HastVisitorContext): Element[] {
  const found: Element[] = [];
  for (let parent = ctx.parent(node); parent && parent.type === 'element'; parent = ctx.parent(parent as HastNode)) found.push(parent);
  return found;
}

const hasClass = (node: Element, name: string): boolean =>
  Array.isArray(node.properties?.className) && node.properties.className.includes(name);

// A break opportunity after each `.` or `:` between letters or digits, so a
// narrow column breaks `00:00:00:00:` / `02:1e`, never mid-token.
const SEPARATOR = /(?<=[\p{L}\p{N}][.:])(?=[\p{L}\p{N}])/u;

function terminal(code: Element): Element {
  const source = code.children.map((child) => (child.type === 'text' ? child.value : '')).join('').replace(/\r?\n$/, '');
  const lines = source.split(/\r?\n/).map((line): Element => {
    // Each .line is display:block, so a blank line needs its own span.
    if (line === '') return el('span', ['line'], [text(' ')]);
    const prompt = /^\$\s?/.exec(line);
    if (!prompt) return el('span', ['line', 'out'], [text(line)]);
    return el('span', ['line'], [el('span', ['prompt'], [text('$')]), text(' '), el('span', ['cmd'], [text(line.slice(prompt[0].length))])]);
  });
  const dots: Element = { ...el('span', ['terminal-dots'], []), properties: { className: ['terminal-dots'], ariaHidden: 'true' } };
  return el('div', ['terminal-block'], [
    el('div', ['terminal-bar'], [dots, el('span', ['terminal-label'], [text('TERMINAL')])]),
    el('pre', undefined, [el('code', undefined, lines)]),
  ]);
}

export const markup = defineHastPlugin({
  name: 'markup',
  element: {
    filter: ['pre'],
    visit(node, ctx) {
      const [code] = node.children;
      if (code?.type === 'element' && code.tagName === 'code' && hasClass(code, 'language-terminal')) ctx.replaceNode(node, terminal(code));
    },
  },
  text(node, ctx) {
    // A separator may open this node while the letter or digit before it
    // closes the previous one.
    const before = previousText(node, ctx);
    const opens = /^[.:][\p{L}\p{N}]/u.test(node.value) && /[\p{L}\p{N}]$/u.test(before);
    if (!opens && !SEPARATOR.test(node.value)) return;
    const chain = ancestors(node, ctx);
    if (!chain.some((parent) => parent.tagName === 'td' || parent.tagName === 'th')) return;
    if (chain.some((parent) => parent.tagName === 'code')) return;
    const parts = node.value.split(SEPARATOR);
    if (opens) parts.splice(0, 1, parts[0]!.slice(0, 1), parts[0]!.slice(1));
    ctx.replaceNode(node, parts.flatMap((part, index) => (index ? [el('wbr', undefined, []), text(part)] : [text(part)])));
  },
});

// Each table ends up in figure.table-figure > div.table-box: one pass adds the
// figure to a bare table, the next adds the box inside it. A :::table block
// already built both.
const wrapTable = (name: string, wraps: (parent: Element | undefined) => boolean, wrapper: () => Element) =>
  defineHastPlugin({
    name,
    element: {
      filter: ['table'],
      visit(node, ctx) {
        const parent = ctx.parent(node);
        if (wraps(parent?.type === 'element' ? parent : undefined)) ctx.wrapNode(node, wrapper());
      },
    },
  });

export const tables = wrapTable('tables', (parent) => !parent || !hasClass(parent, 'table-box'), () => el('figure', ['table-figure'], []));
export const tableBoxes = wrapTable('table-boxes', (parent) => parent !== undefined && hasClass(parent, 'table-figure'), () => el('div', ['table-box'], []));

function previousText(node: HastNode, ctx: HastVisitorContext): string {
  const parent = ctx.parent(node);
  const index = ctx.indexOf(node);
  if (!parent || index === undefined || index === 0) return '';
  const previous = (parent as Element).children[index - 1];
  return previous?.type === 'text' ? previous.value : '';
}
