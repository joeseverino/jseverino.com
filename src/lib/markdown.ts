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
// tested directly (`tests/unit/markdown-dsl.test.ts`). The Astro-aware glue —
// content collections, slug/asset resolution, and <picture> enhancement — lives
// in content.ts, which imports renderPageHtml / renderWriteupHtml from here.

import MarkdownIt, { type MarkdownIt as MarkdownItInstance } from 'markdown-it';

function createMarkdownRenderer() {
  return new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
  });
}

const md = createMarkdownRenderer();
const fragmentMd = createMarkdownRenderer();

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
      : renderer.utils.escapeHtml(tokens[idx].content);
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
      const parts = altRaw.split('|').map((p) => p.trim());
      let alt = parts[0] ?? '';
      let width: string | null = null;
      let nocap = false;
      let nozoom = false;

      for (const part of parts.slice(1)) {
        if (/^\d+$/.test(part)) width = part;
        else if (part.toLowerCase() === 'nocap' || part.toLowerCase() === 'nocaption') nocap = true;
        else if (part.toLowerCase() === 'nozoom') nozoom = true;
      }

      if (!width && !nocap && !nozoom && alt === altRaw) return match;

      const attrs = [
        `src="${url}"`,
        `alt="${alt.replace(/"/g, '&quot;')}"`,
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

  const imageLine = lines[imageIndex].trim();
  // preprocessImageDirectives runs before this, so an image carrying a
  // modifier (|width, |nocap, |nozoom) arrives already as an <img> tag, while
  // a plain image is still ![alt](src). Support both so the explicit caption
  // composes with either.
  const markdownImage = imageLine.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/);
  let imgTag: string;
  if (markdownImage) {
    const [, altRaw, src] = markdownImage;
    imgTag = `<img src="${src}" alt="${altRaw.replace(/"/g, '&quot;')}">`;
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

function renderButton(content: string, classes = ''): string {
  const link = content.match(/\[([^\]]+)\]\(([^)]+)\)/);
  if (!link) return '';
  const className = `button ${classes}`.trim();
  return `<div class="actions"><a class="${className}" href="${link[2]}">${link[1]}</a></div>`;
}

function renderButtons(content: string): string {
  const buttons = [...content.matchAll(/- \[([^\]]+)\]\(([^)]+)\)/g)]
    .map((match, index) => {
      const className = index === 0 ? 'button' : 'button secondary';
      return `<a class="${className}" href="${match[2]}">${match[1]}</a>`;
    })
    .join('\n');
  return `<div class="actions">${buttons}</div>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderTerminal(content: string): string {
  const lines = content.replace(/\r?\n$/, '').split(/\r?\n/);
  const rendered = lines
    .map((line) => {
      if (line === '') return '';
      if (/^\$\s?/.test(line)) {
        const cmd = line.replace(/^\$\s?/, '');
        return `<span class="line"><span class="prompt">$</span> <span class="cmd">${escapeHtml(cmd)}</span></span>`;
      }
      return `<span class="line out">${escapeHtml(line)}</span>`;
    })
    .join('\n');
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
  const [left, ...rest] = parts;
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

// Render a writeup's markdown body to HTML: strip the duplicated H1/lede/hero,
// expand the block DSL, then rewrite relative image paths to the writeup's
// published asset folder. Image <picture> enhancement is layered on by content.ts.
export function renderWriteupHtml(markdown: string, slug: string): string {
  const prepared = applyBlockDirectives(preprocessImageDirectives(stripArticleChrome(markdown)), writeupBlockDirectives);
  const html = md.render(prepared);
  return promoteStandaloneLinks(restoreFigures(html))
    .replaceAll('src="./images/', `src="/assets/writeups/${slug}/images/`)
    .replaceAll('src="images/', `src="/assets/writeups/${slug}/images/`);
}
