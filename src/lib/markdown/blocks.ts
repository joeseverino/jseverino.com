// Container directives (`:::figure`) render to site markup, leaf directives to page components; nothing else is a directive.
import { defineMdastPlugin, type MdastNode, type MdastVisitorContext } from 'satteri';
import type { ListItem, Paragraph, PhrasingContent, RootContent } from 'mdast';

type ContainerDirective = Extract<MdastNode, { type: 'containerDirective' }>;

export const PLACEHOLDERS = ['featured-projects', 'technology-cloud', 'contact-form'] as const;
const placeholders: ReadonlySet<string> = new Set(PLACEHOLDERS);

export const CONTENT_RUN = 'content-run';

type Children = readonly RootContent[];
type Positioned = { position?: { start: { line: number; offset?: number | undefined }; end: { offset?: number | undefined } } | undefined };

const element = (tagName: string, children: readonly unknown[], properties: Record<string, unknown> = {}) =>
  ({ type: tagName, data: { hName: tagName, hProperties: properties }, children }) as unknown as MdastNode;

const line = (node: Positioned): string => (node.position ? ` (line ${node.position.start.line})` : '');

const isParagraph = (node: RootContent | undefined): node is Paragraph => node?.type === 'paragraph';

function inline(nodes: Children): PhrasingContent[] {
  return nodes.flatMap((node, index) => {
    const content = isParagraph(node) ? node.children : [];
    return index === 0 ? content : [{ type: 'text', value: '\n' } as PhrasingContent, ...content];
  });
}

function figure(node: ContainerDirective): MdastNode | readonly RootContent[] {
  const [first, ...rest] = node.children;
  const [image, ...trailing] = isParagraph(first) ? first.children : [];
  if (image?.type !== 'image') return node.children;
  const sameParagraph = trailing.filter((child, index) => index > 0 || !(child.type === 'break' || (child.type === 'text' && !child.value.trim())));
  if (sameParagraph[0]?.type === 'text') sameParagraph[0] = { ...sameParagraph[0], value: sameParagraph[0].value.replace(/^\s+/, '') };
  const captionContent = [...sameParagraph, ...(sameParagraph.length && rest.length ? [{ type: 'text', value: '\n' } as PhrasingContent] : []), ...inline(rest)];
  return element('figure', captionContent.length ? [image, element('figcaption', captionContent)] : [image]);
}

function table(node: ContainerDirective): MdastNode | readonly RootContent[] {
  const [grid, ...caption] = node.children;
  if (grid?.type !== 'table') return node.children;
  const captionContent = inline(caption);
  return element('figure', [element('div', [grid], { className: ['table-box'] }), ...(captionContent.length ? [element('figcaption', captionContent)] : [])], {
    className: ['table-figure'],
  });
}

function button(paragraph: RootContent | undefined, className: string): MdastNode | undefined {
  if (!isParagraph(paragraph) || paragraph.children.length !== 1) return undefined;
  const [link] = paragraph.children;
  if (link?.type !== 'link') return undefined;
  return { ...link, data: { hProperties: { className: className.split(' ') } } } as unknown as MdastNode;
}

function buttons(node: ContainerDirective): MdastNode | readonly RootContent[] {
  const list = node.children[0];
  if (list?.type !== 'list') return [];
  const links = list.children
    .map((item: ListItem, index) => button(item.children[0], index === 0 ? 'button' : 'button secondary'))
    .filter((link): link is MdastNode => link !== undefined);
  return links.length ? element('div', links.flatMap((link, index) => (index ? [{ type: 'text', value: '\n' }, link] : [link])), { className: ['actions'] }) : [];
}

function single(node: ContainerDirective): MdastNode | readonly RootContent[] {
  const sticky = String(node.attributes?.class ?? '').split(/\s+/).includes('sticky');
  const link = button(node.children[0], sticky ? 'button sticky-button' : 'button');
  return link ? element('div', [link], { className: ['actions'] }) : [];
}

function side(node: ContainerDirective): MdastNode {
  const [only] = node.children;
  const bare = node.children.length === 1 && isParagraph(only) && only.children.length === 1 && only.children[0]?.type === 'image';
  return element('div', bare ? only.children : node.children);
}

const CONTAINERS: Record<string, (node: ContainerDirective) => MdastNode | readonly RootContent[]> = {
  figure,
  table,
  buttons,
  button: single,
  center: (node) => element('div', node.children, { className: ['center-text'] }),
  hero: (node) => element('header', node.children, { className: ['hero'] }),
  split: (node) => element('div', node.children, { className: ['split'] }),
  side,
};

function sections(root: { children: Children }, ctx: MdastVisitorContext): void {
  if (!root.children.some((child) => child.type === 'leafDirective')) return;
  const out: unknown[] = [];
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
  ctx.replaceNode(root as never, { type: 'root', children: out } as never);
}

export const blocks = defineMdastPlugin({
  name: 'blocks',
  options: { position: true },
  containerDirective(node, ctx) {
    const render = CONTAINERS[node.name];
    if (!render) throw new Error(`:::${node.name} is not a block${line(node)}`);
    if (node.name === 'side' && ctx.parent(node)?.type !== 'containerDirective') throw new Error(`:::side belongs inside :::split${line(node)}`);
    const result = render(node);
    ctx.replaceNode(node, (Array.isArray(result) ? result : [result]) as MdastNode[]);
  },
  leafDirective(node, ctx) {
    if (!placeholders.has(node.name)) throw new Error(`::${node.name} is not a placeholder${line(node)}`);
    if (ctx.parent(node)?.type !== 'root') throw new Error(`::${node.name} belongs at the top level${line(node)}`);
  },
  after: (root, ctx) => sections(root, ctx),
});
