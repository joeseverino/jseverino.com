// The pure Markdown → HTML layer: the custom block DSL (::terminal, ::figure,
// ::table, ::split, ::buttons, ::center, ::hero) plus the inline rewrites
// (standalone-link buttons, figure restoration).
//
// Every directive is one entry in a table: its name and a renderer from the
// block's inner text to HTML. The page and writeup pipelines are ordered
// lists of those entries, so adding a directive is one line, and the two
// pipelines cannot drift in how they recognize a block.
//
// Everything here is a deterministic string → string transform whose only
// dependency is markdown-it, so it carries no Astro coupling and can be unit
// tested directly (`tests/unit/markdown-dsl.test.ts`). The Astro-aware glue
// (content collections and <picture> enhancement) lives in content.ts, which
// imports renderPageHtml / renderWriteupHtml from here.

import MarkdownIt, { type MarkdownIt as MarkdownItInstance } from 'markdown-it';
import { parseImageDirectives } from './image-directives.ts';

// ---------------------------------------------------------------------------
// Raw HTML allow-list
// ---------------------------------------------------------------------------

// Raw HTML in markdown (and the DSL output, which re-enters markdown as raw
// HTML) is rebuilt from an allow-list: listed tags with listed attributes,
// values entity-decoded then re-escaped, URLs limited to http(s)/mailto or
// relative. Every other tag, and any stray `<`, renders as text; comments drop.
const GLOBAL_ATTRIBUTES = [
  'class',
  'title',
  'aria-hidden',
  'aria-label',
  'data-content-block',
  'data-has-alt-caption',
  'data-no-zoom',
  'data-nocap',
];
const RAW_HTML_TAGS = new Map<string, ReadonlySet<string>>(
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
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto']);

const RAW_TOKEN =
  /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g;
const RAW_ATTRIBUTE = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

const escapeText = (text: string): string => text.replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function isSafeUrl(value: string): boolean {
  // Browsers ignore control characters and whitespace inside a scheme.
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value.replace(/[\u0000-\u0020\u007f]/g, ''))?.[1];
  return !scheme || SAFE_SCHEMES.has(scheme.toLowerCase());
}

function sanitizeAttributes(allowed: ReadonlySet<string>, source: string): string {
  const seen = new Set<string>();
  let out = '';
  for (const [, rawName = '', double, single, bare] of source.matchAll(RAW_ATTRIBUTE)) {
    const name = rawName.toLowerCase();
    if (seen.has(name) || !allowed.has(name)) continue;
    seen.add(name);
    const raw = double ?? single ?? bare;
    if (raw === undefined) {
      out += ` ${name}`;
      continue;
    }
    const value = md.utils.unescapeAll(raw);
    if (URL_ATTRIBUTES.has(name) && !isSafeUrl(value)) continue;
    out += ` ${name}="${escapeHtml(value)}"`;
  }
  return out;
}

export function sanitizeRawHtml(html: string): string {
  let out = '';
  let last = 0;
  for (const match of html.matchAll(RAW_TOKEN)) {
    const [token, closing, rawName, attributes = ''] = match;
    out += escapeText(html.slice(last, match.index));
    last = match.index + token.length;
    if (!rawName) continue;
    const name = rawName.toLowerCase();
    const allowed = RAW_HTML_TAGS.get(name);
    if (!allowed) out += escapeText(token);
    else out += closing ? `</${name}>` : `<${name}${sanitizeAttributes(allowed, attributes)}>`;
  }
  return out + escapeText(html.slice(last));
}

function createMarkdownRenderer() {
  const renderer = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
  });
  renderer.renderer.rules.html_block = (tokens, idx) => sanitizeRawHtml(tokens[idx]?.content ?? '');
  renderer.renderer.rules.html_inline = (tokens, idx) => sanitizeRawHtml(tokens[idx]?.content ?? '');
  return renderer;
}

const md = createMarkdownRenderer();
const fragmentMd = createMarkdownRenderer();
const { escapeHtml } = md.utils;

// Let separator-delimited values (IPs, MACs) wrap at their separators instead of
// mid-token, so a narrow table column breaks `00:00:00:00:` / `02:1e`, never
// `00:00:00:00:0` / `2:1e`. <wbr> is invisible and only adds break opportunities.
const breakAtSeparators = (html: string): string =>
  html.replace(/([\p{L}\p{N}])([.:])(?=[\p{L}\p{N}])/gu, '$1$2<wbr>');

function addCellBreaks(renderer: MarkdownItInstance, onlyInTables: boolean): void {
  const state = { inTable: false };
  const open = renderer.renderer.rules.table_open;
  renderer.renderer.rules.table_open = (...args) => {
    state.inTable = true;
    return open ? open(...args) : '<table>';
  };
  const close = renderer.renderer.rules.table_close;
  renderer.renderer.rules.table_close = (...args) => {
    state.inTable = false;
    return close ? close(...args) : '</table>';
  };
  const text = renderer.renderer.rules.text;
  renderer.renderer.rules.text = (tokens, idx, options, env, self) => {
    const out = text
      ? text(tokens, idx, options, env, self)
      : renderer.utils.escapeHtml(tokens[idx]?.content ?? '');
    return !onlyInTables || state.inTable ? breakAtSeparators(out) : out;
  };
}

md.renderer.rules.table_open = () =>
  '<figure class="table-figure"><div class="table-box"><table>';
md.renderer.rules.table_close = () => '</table></div></figure>';

// fragmentMd renders only ::table bodies, so every cell is fair game.
addCellBreaks(md, true);
addCellBreaks(fragmentMd, false);

// ---------------------------------------------------------------------------
// Directive grammar
// ---------------------------------------------------------------------------

// A block directive opens with `::name` on its own line and closes with `::`
// on its own line; the renderer receives the text between.
type BlockRenderer = (content: string) => string;
type BlockDirective = readonly [name: string, render: BlockRenderer];

const blockClose = String.raw`\n::(?=\r?\n|$)`;
const blockRe = (name: string) => new RegExp(String.raw`::${name}\n([\s\S]*?)${blockClose}`, 'g');

function applyBlockDirectives(markdown: string, directives: readonly BlockDirective[]): string {
  return directives.reduce(
    (text, [name, render]) => text.replace(blockRe(name), (_, content: string) => render(content)),
    markdown,
  );
}

// An inline directive is `::name ::` anywhere in the text, replaced verbatim.
type InlineDirective = readonly [name: string, replacement: string];

const inlineRe = (name: string) => new RegExp(String.raw`::${name}\s*::`, 'g');

function applyInlineDirectives(markdown: string, directives: readonly InlineDirective[]): string {
  return directives.reduce((text, [name, replacement]) => text.replace(inlineRe(name), replacement), markdown);
}

// The body renders as markdown and sits inside one wrapping element.
const wrapRendered = (open: string, close: string): BlockRenderer => (content) =>
  `\n\n${open}${restoreFigures(md.render(content.trim()))}${close}\n\n`;

// ---------------------------------------------------------------------------
// Writeup preprocessing
// ---------------------------------------------------------------------------

function stripArticleChrome(markdown: string): string {
  return markdown
    .trimStart()
    .replace(/^# .+(?:\r?\n)+/, '')
    .replace(/^>\s+.+(?:\r?\n)+/, '')
    .replace(/^!\[[^\]]*\]\([^)]+\)(?:\r?\n)+/, '')
    .trim();
}

function preprocessImageDirectives(markdown: string): string {
  return markdown.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (match, altRaw: string, url: string) => {
      const { alt: parsedAlt, width, noCaption: nocap, noZoom: nozoom } = parseImageDirectives(altRaw);

      if (!width && !nocap && !nozoom && parsedAlt === altRaw) return match;
      // Match Markdown-it's normal image-label semantics before emitting the
      // modifier-bearing raw <img> tag that the renderer will pass through.
      const alt = md.utils.unescapeAll(parsedAlt);

      const attrs = [
        `src="${escapeHtml(url)}"`,
        `alt="${escapeHtml(alt)}"`,
        width ? `width="${width}"` : '',
        nocap ? 'data-nocap' : '',
        nozoom ? 'data-no-zoom' : '',
        alt ? 'data-has-alt-caption' : '',
      ]
        .filter(Boolean)
        .join(' ');

      return `<img ${attrs}>`;
    },
  );
}

// ---------------------------------------------------------------------------
// Block renderers
// ---------------------------------------------------------------------------

function renderFigure(content: string): string {
  const lines = content.trim().split(/\r?\n/);
  const imageIndex = lines.findIndex((line) => line.trim() !== '');
  if (imageIndex === -1) return '';

  const imageLine = (lines[imageIndex] ?? '').trim();
  // preprocessImageDirectives runs before this, so an image carrying a
  // modifier (|width, |nocap, |nozoom) arrives already as an <img> tag, while
  // a plain image is still ![alt](src). Support both so the explicit caption
  // composes with either.
  const markdownImage = imageLine.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/);
  let imgTag: string;
  if (markdownImage) {
    const [, altRaw = '', src = ''] = markdownImage;
    imgTag = `<img src="${escapeHtml(src)}" alt="${escapeHtml(altRaw)}">`;
  } else if (/^<img\b[^>]*>$/.test(imageLine)) {
    // The figure's own caption line supersedes the alt-derived one.
    imgTag = imageLine.replace(/\s*data-has-alt-caption\b/, '');
  } else {
    return md.render(content.trim());
  }

  const captionMarkdown = lines.slice(imageIndex + 1).join('\n').trim();
  const caption = captionMarkdown ? md.renderInline(captionMarkdown) : '';

  return ['<figure>', imgTag, caption ? `<figcaption>${caption}</figcaption>` : '', '</figure>']
    .filter(Boolean)
    .join('');
}

function renderTable(content: string): string {
  const lines = content.trim().split(/\r?\n/);
  const tableLines = [];
  const captionLines = [];
  let inCaption = false;

  for (const line of lines) {
    if (!inCaption && line.trim() !== '' && line.trim().startsWith('|')) {
      tableLines.push(line);
      continue;
    }

    if (line.trim() !== '') inCaption = true;
    if (inCaption) captionLines.push(line);
  }

  if (tableLines.length === 0) return md.render(content.trim());

  const table = fragmentMd.render(tableLines.join('\n')).trim();
  const captionMarkdown = captionLines.join('\n').trim();
  const caption = captionMarkdown ? md.renderInline(captionMarkdown) : '';

  return [
    '<figure class="table-figure">',
    `<div class="table-box">${table}</div>`,
    caption ? `<figcaption>${caption}</figcaption>` : '',
    '</figure>',
  ]
    .filter(Boolean)
    .join('');
}

function renderActionLink(markdown: string, className: string): string {
  const [inline, ...extra] = md.parseInline(markdown.trim(), {});
  const children = (inline?.children ?? []).filter((token) => token.type !== 'text' || token.content !== '');
  if (
    extra.length > 0 ||
    children[0]?.type !== 'link_open' ||
    children.at(-1)?.type !== 'link_close' ||
    children.filter((token) => token.type === 'link_open').length !== 1
  ) {
    return '';
  }
  children[0].attrs = [
    ['class', className],
    ...(children[0].attrs ?? []).filter(([name]) => name !== 'class'),
  ];
  return md.renderer.render(children, md.options, {});
}

function renderButton(content: string, classes = ''): string {
  const link = renderActionLink(content, `button ${classes}`.trim());
  return link ? `<div class="actions">${link}</div>` : '';
}

function renderButtons(content: string): string {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*-\s+(.+)$/)?.[1])
    .filter((line): line is string => Boolean(line));
  const buttons: string[] = [];
  for (const line of lines) {
    const className = buttons.length === 0 ? 'button' : 'button secondary';
    const link = renderActionLink(line, className);
    if (link) buttons.push(link);
  }
  return buttons.length > 0 ? `<div class="actions">${buttons.join('\n')}</div>` : '';
}

function renderTerminal(content: string): string {
  const lines = content.replace(/\r?\n$/, '').split(/\r?\n/);
  const rendered = lines
    .map((line) => {
      // Each .line is display:block, so a blank line needs its own span and the
      // spans join with nothing: a newline between blocks inside <pre> renders
      // as an extra empty row.
      if (line === '') return '<span class="line"> </span>';
      if (/^\$\s?/.test(line)) {
        const cmd = line.replace(/^\$\s?/, '');
        return `<span class="line"><span class="prompt">$</span> <span class="cmd">${escapeHtml(cmd)}</span></span>`;
      }
      return `<span class="line out">${escapeHtml(line)}</span>`;
    })
    .join('');
  return `\n\n<div class="terminal-block"><div class="terminal-bar"><span class="terminal-dots" aria-hidden="true"></span><span class="terminal-label">TERMINAL</span></div><pre><code>${rendered}</code></pre></div>\n\n`;
}

// A side whose entire content is a single image markdown line renders
// inline, so enhanceImages can wrap it as <picture> without a surrounding <p>.
function renderSplitSide(text: string): string {
  const trimmed = text.trim();
  if (/^!\[[^\]]*\]\([^)]+\)$/.test(trimmed)) {
    return md.renderInline(trimmed);
  }
  return restoreFigures(md.render(trimmed));
}

function renderSplit(content: string): string {
  const parts = content.split(/^:::\s*$/m);
  if (parts.length < 2) {
    return `\n\n<div class="split">${renderSplitSide(content)}</div>\n\n`;
  }
  const [left = '', ...rest] = parts;
  const right = rest.join(':::');
  return `\n\n<div class="split"><div>${renderSplitSide(left)}</div><div>${renderSplitSide(right)}</div></div>\n\n`;
}

// ---------------------------------------------------------------------------
// HTML post-passes
// ---------------------------------------------------------------------------

function restoreFigures(html: string): string {
  // Pass 1: image with explicit caption from alt text → figure, drop next-paragraph absorption.
  let result = html.replace(
    /<p><img([^>]*?)data-has-alt-caption([^>]*)><\/p>/g,
    (_match, before: string, after: string) => {
      const attrs = `${before}${after}`.replace(/\s+/g, ' ').trim();
      const altMatch = attrs.match(/alt="([^"]*)"/);
      const caption = altMatch?.[1] ?? '';
      const cleaned = attrs.replace(/\s*data-nocap\b/, '');
      return `<figure><img ${cleaned}><figcaption>${caption}</figcaption></figure>`;
    },
  );

  // Pass 2: image with data-nocap → keep image, leave next paragraph alone.
  result = result.replace(
    /<p><img([^>]*?)data-nocap([^>]*)><\/p>/g,
    (_match, before: string, after: string) => {
      const cleaned = `${before}${after}`.replace(/\s+/g, ' ').trim();
      return `<p><img ${cleaned}></p>`;
    },
  );

  return result;
}

function promoteStandaloneLinks(html: string): string {
  return html.replace(
    /<p><a href="([^"]+)"([^>]*)>([^<]+)<\/a><\/p>/g,
    (_match, href: string, attrs: string, text: string) =>
      `<div class="actions"><a class="button" href="${href}"${attrs}>${text}</a></div>`,
  );
}

// ---------------------------------------------------------------------------
// Pipelines
// ---------------------------------------------------------------------------

const pageInlineDirectives: readonly InlineDirective[] = [
  // ::cta expands to a ::buttons block, so it precedes the block pass.
  ['cta', '\n\n::buttons\n- [View Portfolio](/portfolio/)\n- [Get in Touch](/contact/)\n::\n\n'],
  ['featured-projects', '<div data-content-block="featured-projects"></div>'],
  ['technology-cloud', '<div data-content-block="technology-cloud"></div>'],
];

const pageBlockDirectives: readonly BlockDirective[] = [
  ['buttons', renderButtons],
  ['button sticky', (content) => renderButton(content, 'sticky-button')],
  ['button', (content) => renderButton(content)],
  ['terminal', renderTerminal],
  ['center', wrapRendered('<div class="center-text">', '</div>')],
  ['split', renderSplit],
  ['hero', wrapRendered('<header class="hero">', '</header>')],
];

const writeupBlockDirectives: readonly BlockDirective[] = [
  ['terminal', renderTerminal],
  ['figure', renderFigure],
  ['table', renderTable],
];

// Render a page's markdown body to HTML, applying the inline directives and the
// block DSL. Image <picture> enhancement is layered on by content.ts.
export function renderPageHtml(markdown: string): string {
  const prepared = applyBlockDirectives(applyInlineDirectives(markdown, pageInlineDirectives), pageBlockDirectives);
  return restoreFigures(md.render(prepared));
}

// Render a writeup's markdown body to HTML: strip the duplicated H1/lede/hero
// and expand the block DSL. Asset URLs arrive resolved from the sync. Image
// <picture> enhancement is layered on by content.ts.
export function renderWriteupHtml(markdown: string): string {
  const prepared = applyBlockDirectives(preprocessImageDirectives(stripArticleChrome(markdown)), writeupBlockDirectives);
  return promoteStandaloneLinks(restoreFigures(md.render(prepared)));
}
