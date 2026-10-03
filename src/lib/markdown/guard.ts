// Content is data, never code. MDX would run `import`/`export` and `{…}`
// expressions at build time and treat raw HTML as JSX, so this plugin rejects
// all three outright: a document using them fails the build with its line, and
// `site validate` reports the same before anything is synced.
//
// Raw HTML is limited to an allow-list of tags and string attributes; URL
// attributes must be relative or http(s)/mailto.
import { defineMdastPlugin, type MdxJsxFlowElement, type MdxJsxTextElement } from 'satteri';

const GLOBAL_ATTRIBUTES = ['class', 'title', 'aria-hidden', 'aria-label'];
const ALLOWED = new Map<string, ReadonlySet<string>>(
  Object.entries({
    a: ['href', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height', 'loading', 'decoding'],
    ol: ['start'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan', 'scope'],
    ...Object.fromEntries(
      ('abbr b blockquote br caption code dd del div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 ' +
        'header hr i kbd li mark p pre s small span strong sub sup table tbody tfoot thead tr u ul wbr')
        .split(' ')
        .map((tag) => [tag, []]),
    ),
  }).map(([tag, attributes]) => [tag, new Set([...GLOBAL_ATTRIBUTES, ...attributes])]),
);
const URL_ATTRIBUTES = new Set(['href', 'src']);
const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

export function isSafeUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!/^[a-z][a-z\d+.-]*:/i.test(trimmed)) return true;
  return SAFE_SCHEMES.has(trimmed.slice(0, trimmed.indexOf(':') + 1).toLowerCase());
}

type Positioned = { position?: { start: { line: number; column: number } } | undefined };
const at = (node: Positioned): string =>
  node.position ? ` (line ${node.position.start.line}, column ${node.position.start.column})` : '';

function fail(message: string, node: Positioned): never {
  throw new Error(`${message}${at(node)}`);
}

function checkElement(node: MdxJsxFlowElement | MdxJsxTextElement): void {
  const name = node.name ?? '';
  const allowed = ALLOWED.get(name);
  if (!allowed) fail(`<${name || 'fragment'}> is not allowed in content`, node);
  for (const attribute of node.attributes) {
    if (attribute.type !== 'mdxJsxAttribute') fail(`<${name}> takes no spread attributes`, node);
    if (!allowed.has(attribute.name)) fail(`attribute ${attribute.name} is not allowed on <${name}>`, node);
    if (attribute.value !== null && typeof attribute.value !== 'string') {
      fail(`attribute ${attribute.name} on <${name}> must be a plain string`, node);
    }
    if (URL_ATTRIBUTES.has(attribute.name) && typeof attribute.value === 'string' && !isSafeUrl(attribute.value)) {
      fail(`${attribute.name}="${attribute.value}" on <${name}> uses a scheme other than http(s) or mailto`, node);
    }
  }
}

export const contentGuard = defineMdastPlugin({
  name: 'content-guard',
  options: { position: true },
  mdxjsEsm: (node) => fail('import and export are not allowed in content', node),
  mdxFlowExpression: (node) => fail(`{${node.value}} is an expression; escape the brace as \\{ to write it literally`, node),
  mdxTextExpression: (node) => fail(`{${node.value}} is an expression; escape the brace as \\{ to write it literally`, node),
  mdxJsxFlowElement: (node) => checkElement(node),
  mdxJsxTextElement: (node) => checkElement(node),
  link: (node) => (isSafeUrl(node.url) ? undefined : fail(`link to ${node.url} uses a scheme other than http(s) or mailto`, node)),
  image: (node) => (isSafeUrl(node.url) ? undefined : fail(`image ${node.url} uses a scheme other than http(s) or mailto`, node)),
});
