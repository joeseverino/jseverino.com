// The content renderer (src/lib/markdown/): the block vocabulary, the inline
// conventions, and the guard that keeps content from being code. Markdown in,
// HTML out, through Sätteri with the site's plugins and no build. The guard
// cases compile as MDX, the format content ships in, and expect a refusal.
//
//   npm run test:unit

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, html, render } from './helpers/render.ts';

describe('```terminal', () => {
  test('renders a prompt span for $-prefixed lines and an output span otherwise', () => {
    const html = render('```terminal\n$ ssh edge\nConnected.\n```');
    assert.match(html, /<div class="terminal-block"><div class="terminal-bar"><span class="terminal-dots" aria-hidden="true"><\/span><span class="terminal-label">TERMINAL<\/span><\/div>/);
    assert.match(html, /<span class="line"><span class="prompt">\$<\/span> <span class="cmd">ssh edge<\/span><\/span><span class="line out">Connected\.<\/span>/);
  });

  test('escapes content as text, so markup in output stays literal', () => {
    const html = render('```terminal\n$ echo "<b>x</b>"\n  source-address <my tailnet addresses>\n```');
    assert.match(html, /<span class="cmd">echo "&lt;b&gt;x&lt;\/b&gt;"<\/span>/);
    assert.match(html, /&lt;my tailnet addresses&gt;/);
    compile('```terminal\n  source-address <my tailnet addresses>\n```');
  });

  test('keeps a blank line as its own row', () => {
    assert.match(render('```terminal\none\n\ntwo\n```'), /<span class="line out">one<\/span><span class="line"> <\/span><span class="line out">two<\/span>/);
  });

  test('other fences stay ordinary code blocks', () => {
    assert.match(render('```text\nplain\n```'), /<pre><code class="language-text">plain\n<\/code><\/pre>/);
  });
});

describe(':::figure', () => {
  test('builds a figure with the line after the image as its caption', () => {
    assert.equal(render(':::figure\n![Alt](./images/a.png)\nThe caption.\n:::'), '<figure><img src="./images/a.png" alt="Alt"><figcaption>The caption.</figcaption></figure>');
  });

  test('takes the caption from the paragraph after a blank line too', () => {
    assert.equal(render(':::figure\n![Alt](./images/a.png)\n\nThe *caption*.\n:::'), '<figure><img src="./images/a.png" alt="Alt"><figcaption>The <em>caption</em>.</figcaption></figure>');
  });

  test('is just its content when it holds no image', () => {
    assert.equal(render(':::figure\nOnly text.\n:::'), '<p>Only text.</p>');
  });
});

describe(':::table and tables', () => {
  test('wraps a table in a scrollable figure and renders the caption', () => {
    const html = render(':::table\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nCaption.\n:::');
    assert.match(html, /^<figure class="table-figure"><div class="table-box"><table>.*<\/table><\/div><figcaption>Caption\.<\/figcaption><\/figure>$/);
  });

  test('wraps a bare table the same way, without a caption', () => {
    assert.match(render('| A |\n| --- |\n| 1 |'), /^<figure class="table-figure"><div class="table-box"><table>.*<\/table><\/div><\/figure>$/);
  });

  test('lets addresses in cells break at their separators, but not in code', () => {
    const html = render('| IP | MAC | Code |\n| --- | --- | --- |\n| 10.0.0.1 | 00:00:00:00:01:1e | `a.b` |');
    assert.match(html, /<td>10\.<wbr>0\.<wbr>0\.<wbr>1<\/td>/);
    assert.match(html, /<td>00:<wbr>00:<wbr>00:<wbr>00:<wbr>01:<wbr>1e<\/td>/);
    assert.match(html, /<td><code>a\.b<\/code><\/td>/);
  });
});

describe('text that looks like a directive', () => {
  test('a MAC address or host:port stays literal text', () => {
    assert.equal(render('Gateway 00:00:00:00:02:1e on host:port.'), '<p>Gateway 00:00:00:00:02:1e on host:port.</p>');
  });
});

describe(':::split', () => {
  test('renders two sides', () => {
    assert.equal(render('::::split\n:::side\nLeft\n:::\n:::side\nRight\n:::\n::::', 'pages'), '<div class="split"><div><p>Left</p></div><div><p>Right</p></div></div>');
  });

  test('renders an image-only side bare, without a paragraph', () => {
    assert.match(render('::::split\n:::side\n![Me|340](./images/me.jpg)\n:::\n:::side\nText\n:::\n::::', 'pages'), /<div class="split"><div><img src="\.\/images\/me\.jpg" alt="Me" width="340"><\/div>/);
  });

  test('a side outside a split is refused', () => {
    assert.throws(() => render(':::side\nLost\n:::', 'pages'), /:::side belongs inside :::split/);
  });
});

describe(':::button and :::buttons', () => {
  test('renders one action button', () => {
    assert.equal(render(':::button\n[Resume](/resume/)\n:::', 'pages'), '<div class="actions"><a href="/resume/" class="button">Resume</a></div>');
  });

  test('{.sticky} adds the sticky-button class', () => {
    assert.match(render(':::button{.sticky}\n[Resume](/r.pdf)\n:::', 'pages'), /class="button sticky-button"/);
  });

  test('marks the first link primary and the rest secondary', () => {
    // The newline between buttons is the gap between them.
    assert.equal(html(':::buttons\n- [One](/1/)\n- [Two](/2/)\n- [Three](/3/)\n:::', 'pages').trim(), '<div class="actions"><a href="/1/" class="button">One</a>\n<a href="/2/" class="button secondary">Two</a>\n<a href="/3/" class="button secondary">Three</a></div>');
  });

  test('a row that is not a lone link is left out', () => {
    assert.equal(render(':::buttons\n- [One](/1/)\n- just text\n:::', 'pages'), '<div class="actions"><a href="/1/" class="button">One</a></div>');
  });
});

describe(':::center and :::hero', () => {
  test('wrap their rendered body', () => {
    assert.equal(render(':::center\nHi\n:::', 'pages'), '<div class="center-text"><p>Hi</p></div>');
    assert.equal(render(':::hero\n# Title\n:::', 'pages'), '<header class="hero"><h1>Title</h1></header>');
  });

  test('nest with longer fences outside', () => {
    assert.match(render('::::hero\n# Hi\n\n:::buttons\n- [A](/a/)\n:::\n::::', 'pages'), /^<header class="hero"><h1>Hi<\/h1><div class="actions"><a href="\/a\/" class="button">A<\/a><\/div><\/header>$/);
  });
});

describe('placeholders', () => {
  test('a leaf directive renders its component, with the prose between in runs', () => {
    assert.equal(render('Intro.\n\n::featured-projects\n\nMore.', 'pages'), '<content-run><p>Intro.</p></content-run><featured-projects></featured-projects><content-run><p>More.</p></content-run>');
  });

  test('a document without placeholders is not split into runs', () => {
    assert.equal(render('Just prose.', 'pages'), '<p>Just prose.</p>');
  });

  test('an unknown block or placeholder is refused, with its line', () => {
    assert.throws(() => render('\n:::callout\nx\n:::'), /:::callout is not a block \(line 2\)/);
    assert.throws(() => render('::cta'), /::cta is not a placeholder/);
  });
});

describe('images', () => {
  test('`alt|width` sets the display width and cleans the alt', () => {
    assert.equal(render('![WinterFest 5K, 2025.|400](./images/run.jpg)', 'pages'), '<p><img src="./images/run.jpg" alt="WinterFest 5K, 2025." width="400"></p>');
  });

  test('`nozoom` opts the image out of the lightbox', () => {
    assert.match(render('![Diagram|nozoom](./images/d.png)'), /<img src="\.\/images\/d\.png" alt="Diagram" data-no-zoom="">/);
  });

  test('a plain image stays a plain paragraph image', () => {
    assert.equal(render('![Alt](./images/a.png)'), '<p><img src="./images/a.png" alt="Alt"></p>');
  });
});

describe('standalone links', () => {
  test('in a writeup, a link alone in a paragraph becomes a button', () => {
    assert.equal(render('[View on GitHub](https://github.com/x)'), '<div class="actions"><a href="https://github.com/x" class="button">View on GitHub</a></div>');
  });

  test('on a page it stays a paragraph link', () => {
    assert.equal(render('[About](/about/)', 'pages'), '<p><a href="/about/">About</a></p>');
  });
});

describe('content is data, not code', () => {
  test('import and export are refused', () => {
    assert.throws(() => compile('import fs from "node:fs"\n\nText'), /import and export are not allowed/);
    assert.throws(() => compile('export const x = process.env.HOME\n\nText'), /import and export are not allowed/);
  });

  test('expressions are refused, with how to write a literal brace', () => {
    assert.throws(() => compile('{process.exit(1)}'), /expression; escape the brace/);
    assert.throws(() => compile('Hello {1+1}'), /expression; escape the brace/);
    compile('Hello \\{1+1\\}');
  });

  test('tags outside the allow-list are refused', () => {
    for (const markup of ['<script>alert(1)</script>', '<iframe src="https://evil.example/"></iframe>', '<style>p{}</style>', '<svg></svg>', '<object data="x"></object>']) {
      assert.throws(() => compile(`Text ${markup}`), /is not allowed in content/, markup);
    }
  });

  test('event handlers, expression values, and spreads are refused', () => {
    assert.throws(() => compile('<span onClick="x()">y</span>'), /attribute onClick is not allowed/);
    assert.throws(() => compile('<span class={evil()}>y</span>'), /must be a plain string/);
    assert.throws(() => compile('<span {...props}>y</span>'), /takes no spread attributes/);
  });

  test('unsafe URL schemes are refused in links, images, reference definitions, and raw HTML', () => {
    for (const markup of ['[a](javascript:alert(1))', '![b](javascript:alert(1))', '[c][r]\n\n[r]: javascript:alert(1)', '![d][r]\n\n[r]: javascript:alert(1)', '<a href="javascript:alert(1)">e</a>', '<a href=" JaVaScRiPt:alert(1)">f</a>']) {
      assert.throws(() => compile(markup), /scheme other than http\(s\) or mailto/, markup);
    }
  });

  test('HTML comments do not compile', () => {
    assert.throws(() => compile('<!-- note -->\n\nText'));
  });

  test('the raw HTML published content uses compiles', () => {
    compile('<p class="hero-eyebrow">Cybersecurity • Networking • AI</p>\n\nText <kbd>Ctrl</kbd> and <a href="https://example.com/" target="_blank" rel="noopener">x</a>.');
  });
});
