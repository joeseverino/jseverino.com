// HTML-level finishing: a ```terminal fence renders as the terminal block, and
// every table sits in a scrollable figure.

import type { Element, ElementContent, Text } from 'hast';
import { defineHastPlugin } from 'satteri';

const el = (tagName: string, className: string[] | undefined, children: ElementContent[], properties: Element['properties'] = {}): Element => ({
  type: 'element',
  tagName,
  properties: className ? { className, ...properties } : properties,
  children,
});
const text = (value: string): Text => ({ type: 'text', value });

const hasClass = (node: Element, name: string): boolean => Array.isArray(node.properties?.className) && node.properties.className.includes(name);

function terminal(code: Element): Element {
  const source = code.children
    .map((child) => (child.type === 'text' ? child.value : ''))
    .join('')
    .replace(/\r?\n$/, '');
  const lines = source.split(/\r?\n/).map((line): Element => {
    // Each .line is display:block, so a blank line needs its own span.
    if (line === '') return el('span', ['line'], [text(' ')]);
    const prompt = /^\$\s?/.exec(line);
    if (!prompt) return el('span', ['line', 'out'], [text(line)]);
    return el('span', ['line'], [el('span', ['prompt'], [text('$')]), text(' '), el('span', ['cmd'], [text(line.slice(prompt[0].length))])]);
  });
  const dots = el('span', ['terminal-dots'], [], { ariaHidden: 'true' });
  return el(
    'div',
    ['terminal-block'],
    [el('div', ['terminal-bar'], [dots, el('span', ['terminal-label'], [text('TERMINAL')])]), el('pre', undefined, [el('code', undefined, lines)])],
  );
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

export const tables = wrapTable(
  'tables',
  (parent) => !parent || !hasClass(parent, 'table-box'),
  () => el('figure', ['table-figure'], []),
);
export const tableBoxes = wrapTable(
  'table-boxes',
  (parent) => parent !== undefined && hasClass(parent, 'table-figure'),
  () => el('div', ['table-box'], []),
);
