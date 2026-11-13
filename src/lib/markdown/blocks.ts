// Container directives (`:::figure`) render to site markup, leaf directives to page components; nothing else is a directive.

import type { Properties } from 'hast';
import type { Link, ListItem, Paragraph, PhrasingContent, Root, RootContent, Text } from 'mdast';
import { type Custom, defineMdastPlugin, type MdastNode, type MdastVisitorContext } from 'satteri';

type ContainerDirective = Extract<MdastNode, { type: 'containerDirective' }>;

export const PLACEHOLDERS = ['featured-projects', 'technology-cloud', 'contact-form'] as const;
const placeholders: ReadonlySet<string> = new Set(PLACEHOLDERS);

export const CONTENT_RUN = 'content-run';

type Children = readonly RootContent[];
type Node = MdastNode | Custom;
type Positioned = { position?: { start: { line: number; offset?: number | undefined }; end: { offset?: number | undefined } } | undefined };

// A node of the site's own markup: satteri renders a custom node as the element `data.hName` names.
const element = (tagName: string, children: readonly Node[], properties: Properties = {}): Custom => ({
  type: tagName,
  data: { hName: tagName, hProperties: properties },
  children: [...children],
});

const newline: Text = { type: 'text', value: '\n' };

const line = (node: Positioned): string => (node.position ? ` (line ${node.position.start.line})` : '');

const isParagraph = (node: RootContent | undefined): node is Paragraph => node?.type === 'paragraph';

function inline(nodes: Children): PhrasingContent[] {
  return nodes.flatMap((node, index) => {
    const content = isParagraph(node) ? node.children : [];
    return index === 0 ? content : [newline, ...content];
  });
}

function figure(node: ContainerDirective): Custom | Children {
  const [first, ...rest] = node.children;
  const [image, ...trailing] = isParagraph(first) ? first.children : [];
  if (image?.type !== 'image') return node.children;
  const sameParagraph = trailing.filter((child, index) => index > 0 || !(child.type === 'break' || (child.type === 'text' && !child.value.trim())));
  if (sameParagraph[0]?.type === 'text') sameParagraph[0] = { ...sameParagraph[0], value: sameParagraph[0].value.replace(/^\s+/, '') };
  const captionContent = [...sameParagraph, ...(sameParagraph.length && rest.length ? [newline] : []), ...inline(rest)];
  return element('figure', captionContent.length ? [image, element('figcaption', captionContent)] : [image]);
}

function table(node: ContainerDirective): Custom | Children {
  const [grid, ...caption] = node.children;
  if (grid?.type !== 'table') return node.children;
  const captionContent = inline(caption);
  return element('figure', [element('div', [grid], { className: ['table-box'] }), ...(captionContent.length ? [element('figcaption', captionContent)] : [])], {
    className: ['table-figure'],
  });
}

function button(paragraph: RootContent | undefined, className: string): Link | undefined {
  if (!isParagraph(paragraph) || paragraph.children.length !== 1) return undefined;
  const [link] = paragraph.children;
  if (link?.type !== 'link') return undefined;
  return { ...link, data: { hProperties: { className: className.split(' ') } } };
}

function buttons(node: ContainerDirective): Custom {
  const [list] = node.children;
  if (node.children.length !== 1 || list?.type !== 'list') throw new Error(`:::buttons holds one list of links${line(node)}`);
  const links = list.children.map((item: ListItem, index) => {
    const link = item.children.length === 1 ? button(item.children[0], index === 0 ? 'button' : 'button secondary') : undefined;
    if (!link) throw new Error(`:::buttons items are each one bare link${line(item)}`);
    return link;
  });
  return element(
    'div',
    links.flatMap((link, index) => (index ? [newline, link] : [link])),
    { className: ['actions'] },
  );
}

function single(node: ContainerDirective): Custom {
  const sticky = String(node.attributes?.class ?? '')
    .split(/\s+/)
    .includes('sticky');
  const link = node.children.length === 1 ? button(node.children[0], sticky ? 'button sticky-button' : 'button') : undefined;
  if (!link) throw new Error(`:::button holds one bare link${line(node)}`);
  return element('div', [link], { className: ['actions'] });
}

// A hero paragraph's hard-broken lines each wrap and balance on their own, so each is its own block-level span.
function heroLines(node: RootContent): Node {
  if (!isParagraph(node) || !node.children.some((child) => child.type === 'break')) return node;
  const lines: PhrasingContent[][] = [[]];
  for (const child of node.children) {
    if (child.type === 'break') lines.push([]);
    else lines.at(-1)?.push(child);
  }
  return { type: 'paragraph', children: lines.map((line) => element('span', line, { className: ['hero-line'] })) };
}

function side(node: ContainerDirective): Custom {
  const [only] = node.children;
  const bare = node.children.length === 1 && isParagraph(only) && only.children.length === 1 && only.children[0]?.type === 'image';
  return element('div', bare ? only.children : node.children);
}

const CONTAINERS: Record<string, (node: ContainerDirective) => Custom | Children> = {
  figure,
  table,
  buttons,
  button: single,
  center: (node) => element('div', node.children, { className: ['center-text'] }),
  hero: (node) => element('header', node.children.map(heroLines), { className: ['hero'] }),
  split: (node) => element('div', node.children, { className: ['split'] }),
  side,
};

function sections(root: Readonly<Root>, ctx: MdastVisitorContext): void {
  if (!root.children.some((child) => child.type === 'leafDirective')) return;
  const out: Custom[] = [];
  let run: RootContent[] = [];
  const flush = () => {
    if (run.length) out.push(element(CONTENT_RUN, run));
    run = [];
  };
  for (const child of root.children) {
    if (child.type !== 'leafDirective') {
      run.push(child);
      continue;
    }
    flush();
    out.push(element(child.name, []));
  }
  flush();
  ctx.replaceNode(root, { type: 'root', children: out });
}

export const blocks = defineMdastPlugin({
  name: 'blocks',
  options: { position: true },
  containerDirective(node, ctx) {
    const render = CONTAINERS[node.name];
    if (!render) throw new Error(`:::${node.name} is not a block${line(node)}`);
    if (node.name === 'side' && ctx.parent(node)?.type !== 'containerDirective') throw new Error(`:::side belongs inside :::split${line(node)}`);
    const result = render(node);
    ctx.replaceNode(node, 'type' in result ? result : [...result]);
  },
  leafDirective(node, ctx) {
    if (!placeholders.has(node.name)) throw new Error(`::${node.name} is not a placeholder${line(node)}`);
    if (ctx.parent(node)?.type !== 'root') throw new Error(`::${node.name} belongs at the top level${line(node)}`);
  },
  after: sections,
});
