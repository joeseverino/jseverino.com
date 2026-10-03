// Unit tests for the custom Markdown DSL in src/lib/markdown.ts.
//
// These run without a browser or a build: markdown in, HTML out. They double as
// executable documentation of the block grammar (::terminal, ::figure, ::table,
// ::split, ::buttons, ::center, ::hero) and the inline rewrites (standalone-link
// tooltips, standalone-link buttons, image directives, writeup chrome stripping).
//
//   npm run test:unit
//
// renderPageHtml drives the page directives; renderWriteupHtml drives the writeup
// pipeline (chrome strip + slug-relative asset rewriting). Image <picture>
// enhancement happens in content.ts and is out of scope here.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPageHtml, renderWriteupHtml } from '../../src/lib/markdown.ts';

describe('::terminal', () => {
  test('renders a prompt span for $-prefixed lines and an output span otherwise', () => {
    const html = renderPageHtml('::terminal\n$ npm run build\ndone\n::');
    assert.match(html, /<div class="terminal-block">/);
    assert.match(html, /<span class="prompt">\$<\/span> <span class="cmd">npm run build<\/span>/);
    assert.match(html, /<span class="line out">done<\/span>/);
  });

  test('HTML-escapes command content', () => {
    const html = renderPageHtml('::terminal\n$ echo "<b>"\n::');
    assert.match(html, /<span class="cmd">echo &quot;&lt;b&gt;&quot;<\/span>/);
    assert.doesNotMatch(html, /<b>/);
  });

  test('joins line spans without newlines and keeps blank lines', () => {
    const html = renderPageHtml('::terminal\n$ ls\n\nout\n::');
    assert.doesNotMatch(html, /<\/span>\n<span class="line/);
    assert.match(html, /<span class="line"> <\/span><span class="line out">out<\/span>/);
  });

  test('HTML-escapes non-command output lines', () => {
    const html = renderPageHtml('::terminal\n<not a tag>\n::');
    assert.match(html, /<span class="line out">&lt;not a tag&gt;<\/span>/);
  });
});

describe('::split', () => {
  test('splits two panes on the ::: divider', () => {
    const html = renderPageHtml('::split\nleft side\n:::\nright side\n::');
    assert.match(html, /<div class="split"><div>[\s\S]*left side[\s\S]*<\/div><div>[\s\S]*right side[\s\S]*<\/div><\/div>/);
  });

  test('renders a single pane when there is no divider', () => {
    const html = renderPageHtml('::split\nonly side\n::');
    assert.match(html, /<div class="split">[\s\S]*only side[\s\S]*<\/div>/);
    assert.doesNotMatch(html, /<div class="split"><div>/);
  });

  test('renders an image-only side inline, without a wrapping paragraph', () => {
    const html = renderPageHtml('::split\n![L](l.png)\n:::\n![R](r.png)\n::');
    assert.match(html, /<div class="split"><div><img src="l\.png" alt="L"><\/div><div><img src="r\.png" alt="R"><\/div><\/div>/);
  });
});

describe('::button (single)', () => {
  test('renders one action button', () => {
    const html = renderPageHtml('::button\n[Resume](/resume.pdf)\n::');
    assert.match(html, /<div class="actions"><a class="button" href="\/resume\.pdf">Resume<\/a><\/div>/);
  });

  test('::button sticky adds the sticky-button class', () => {
    const html = renderPageHtml('::button sticky\n[Resume](/resume.pdf)\n::');
    assert.match(html, /<a class="button sticky-button" href="\/resume\.pdf">Resume<\/a>/);
  });

  test('uses the Markdown link parser for escaping, formatting, and parentheses in URLs', () => {
    const html = renderPageHtml('::button\n[**Open & inspect**](https://example.com/a_(b))\n::');
    assert.match(html, /<a class="button" href="https:\/\/example\.com\/a_\(b\)"><strong>Open &amp; inspect<\/strong><\/a>/);
  });

  test('does not turn unsafe or malformed links into HTML', () => {
    for (const link of ['[Bad](javascript:alert(1))', 'plain text']) {
      const html = renderPageHtml(`::button\n${link}\n::`);
      assert.doesNotMatch(html, /class="actions"|<a\b|javascript:/);
    }
  });
});

describe('::buttons', () => {
  test('marks the first link primary and the rest secondary', () => {
    const html = renderPageHtml('::buttons\n- [First](/a/)\n- [Second](/b/)\n::');
    assert.match(html, /<a class="button" href="\/a\/">First<\/a>/);
    assert.match(html, /<a class="button secondary" href="\/b\/">Second<\/a>/);
  });

  test('omits invalid rows while preserving primary and secondary order', () => {
    const html = renderPageHtml('::buttons\n- [First](/a/)\n- [Bad](javascript:alert(1))\n- [Third](/c/)\n::');
    assert.match(html, /<a class="button" href="\/a\/">First<\/a>/);
    assert.match(html, /<a class="button secondary" href="\/c\/">Third<\/a>/);
    assert.doesNotMatch(html, /javascript:|>Bad</);
  });
});

describe('::cta', () => {
  test('expands to the portfolio + contact button pair', () => {
    const html = renderPageHtml('::cta::');
    assert.match(html, /<a class="button" href="\/portfolio\/">View Portfolio<\/a>/);
    assert.match(html, /<a class="button secondary" href="\/contact\/">Get in Touch<\/a>/);
  });
});

describe('content-block placeholders', () => {
  test('::featured-projects:: and ::technology-cloud:: become data-content-block divs', () => {
    assert.match(renderPageHtml('::featured-projects::'), /<div data-content-block="featured-projects"><\/div>/);
    assert.match(renderPageHtml('::technology-cloud::'), /<div data-content-block="technology-cloud"><\/div>/);
  });
});

describe('::center and ::hero', () => {
  test('wrap their rendered body in the matching element', () => {
    assert.match(renderPageHtml('::center\ncentered\n::'), /<div class="center-text"><p>centered<\/p>\s*<\/div>/);
    assert.match(renderPageHtml('::hero\nbanner\n::'), /<header class="hero"><p>banner<\/p>\s*<\/header>/);
  });
});

describe('external links', () => {
  test('renders the public HQ repository normally', () => {
    const html = renderPageHtml('[Severino HQ](https://github.com/joeseverino/severino-hq)');
    assert.match(html, /href="https:\/\/github\.com\/joeseverino\/severino-hq"/);
  });
});

describe('::figure (writeup)', () => {
  test('builds a figure with the trailing line as its caption', () => {
    const html = renderWriteupHtml('::figure\n![A cat](cat.png)\nA caption here\n::');
    assert.match(html, /<figure><img src="cat\.png" alt="A cat"><figcaption>A caption here<\/figcaption><\/figure>/);
  });

  test('falls back to plain rendering when the block has no image line', () => {
    const html = renderWriteupHtml('::figure\nnot an image line\n::');
    assert.match(html, /<p>not an image line<\/p>/);
    assert.doesNotMatch(html, /<figure>/);
  });

  test('honors a |nozoom modifier on the figure image', () => {
    const html = renderWriteupHtml('::figure\n![A cat|nozoom](cat.png)\nA caption here\n::');
    assert.match(html, /<figure><img src="cat\.png" alt="A cat" data-no-zoom><figcaption>A caption here<\/figcaption><\/figure>/);
  });
});

describe('::table (writeup)', () => {
  test('wraps the table in a table-figure and renders the trailing caption', () => {
    const html = renderWriteupHtml('::table\n| A | B |\n| - | - |\n| 1 | 2 |\nTable caption\n::');
    assert.match(html, /<figure class="table-figure"><div class="table-box"><table>/);
    assert.match(html, /<th>A<\/th>/);
    assert.match(html, /<figcaption>Table caption<\/figcaption>/);
  });

  test('falls back to plain rendering when the block has no table rows', () => {
    const html = renderWriteupHtml('::table\njust a caption\n::');
    assert.match(html, /<p>just a caption<\/p>/);
    assert.doesNotMatch(html, /table-figure/);
  });
});

describe('image directives (writeup)', () => {
  test('escapes image attributes without treating literal entities as markup', () => {
    const html = renderWriteupHtml('![A < B & "C" &copy;|320](photo.png?a=1&b=2)');
    assert.match(html, /src="photo\.png\?a=1&amp;b=2"/);
    assert.match(html, /alt="A &lt; B &amp; &quot;C&quot; ©"/);
  });

  // markdown.ts parses the `alt|width|nocap` directive into <img> attributes;
  // the <figure>/<picture> wrapping is assembled downstream in enhanceImages.
  test('`alt|width` parses the width into an attribute and flags the alt caption', () => {
    const html = renderWriteupHtml('![A cat|320](photo.png)');
    assert.match(html, /<img src="photo\.png" alt="A cat" width="320" data-has-alt-caption>/);
  });

  test('a plain image without a directive stays an inline paragraph image', () => {
    const html = renderWriteupHtml('![A cat](photo.png)');
    assert.match(html, /<p><img src="photo\.png" alt="A cat"><\/p>/);
  });

  test('`nocap` with alt text flags both data-nocap and data-has-alt-caption', () => {
    const html = renderWriteupHtml('![A cat|nocap](photo.png)');
    assert.match(html, /<img src="photo\.png" alt="A cat" data-nocap data-has-alt-caption>/);
  });

  test('`nocap` with empty alt flags data-nocap only', () => {
    const html = renderWriteupHtml('![|nocap](photo.png)');
    assert.match(html, /<img src="photo\.png" alt="" data-nocap>/);
  });

  test('`nozoom` flags data-no-zoom so the image opts out of the lightbox', () => {
    const html = renderWriteupHtml('![A cat|nozoom](photo.png)');
    assert.match(html, /<img src="photo\.png" alt="A cat" data-no-zoom data-has-alt-caption>/);
  });
});

describe('fenced code (writeup)', () => {
  test('tags a fenced block with its markdown-it language class', () => {
    const html = renderWriteupHtml('```bash\nls -la\n```');
    assert.match(html, /<pre><code class="language-bash">ls -la\n<\/code><\/pre>/);
  });
});

describe('standalone links (writeup)', () => {
  test('a link alone in a paragraph is promoted to an action button', () => {
    const html = renderWriteupHtml('[Download the PDF](https://example.com/file.pdf)');
    assert.match(html, /<div class="actions"><a class="button" href="https:\/\/example\.com\/file\.pdf">Download the PDF<\/a><\/div>/);
  });
});

describe('writeup chrome + asset paths', () => {
  test('strips a leading H1 so the article title is not duplicated', () => {
    const html = renderWriteupHtml('# Building a Homelab\n\nReal body text.');
    assert.doesNotMatch(html, /<h1>/);
    assert.match(html, /Real body text\./);
  });

  test('strips a leading blockquote lede', () => {
    const html = renderWriteupHtml('> A short lede.\n\nReal body text.');
    assert.doesNotMatch(html, /<blockquote>/);
    assert.match(html, /<p>Real body text\.<\/p>/);
  });

  test('strips a leading hero image so it is not repeated in the body', () => {
    const html = renderWriteupHtml('![hero](cover.png)\n\nReal body text.');
    assert.doesNotMatch(html, /cover\.png/);
    assert.match(html, /<p>Real body text\.<\/p>/);
  });
});

describe('raw HTML allow-list', () => {
  const renderBoth = (markdown: string) => [renderPageHtml(markdown), renderWriteupHtml(markdown)];

  test('a <script> renders as text', () => {
    for (const html of renderBoth('Intro\n\n<script>alert(1)</script>\n\nText <script src="/x.js"></script>')) {
      assert.doesNotMatch(html, /<script/i);
      assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    }
  });

  test('a script carrying the nonce placeholder still renders as text', () => {
    for (const html of renderBoth('<script nonce="__CSP_NONCE__">alert(1)</script>')) {
      assert.doesNotMatch(html, /<script/i);
    }
  });

  test('an <iframe>, <style>, <object>, and <svg> render as text', () => {
    for (const tag of ['iframe src="https://evil.example/"', 'style', 'object data="x"', 'svg onload="alert(1)"']) {
      for (const html of renderBoth(`<${tag}></${tag.split(' ')[0]}>`)) {
        assert.doesNotMatch(html, new RegExp(`<${tag.split(' ')[0]}`, 'i'));
      }
    }
  });

  test('event handler attributes are dropped from allowed tags', () => {
    for (const html of renderBoth('<img src="/a.png" alt="a" onerror="alert(1)">\n\n<p onclick=alert(1) class="x">hi</p>')) {
      assert.doesNotMatch(html, /onerror|onclick/i);
      assert.match(html, /<img src="\/a.png" alt="a">/);
      assert.match(html, /<p class="x">hi<\/p>/);
    }
  });

  test('javascript: URLs are dropped, however they are spelled', () => {
    const links = [
      '<a href="javascript:alert(1)">a</a>',
      '<a href="JaVaScRiPt:alert(1)">b</a>',
      '<a href="jav&#x09;ascript:alert(1)">c</a>',
      '<a href="&#106;avascript:alert(1)">d</a>',
      '<a href=" javascript:alert(1)">e</a>',
      '<img src="javascript:alert(1)" alt="f">',
      '[g](javascript:alert(1))',
    ];
    for (const html of renderBoth(links.join('\n\n'))) {
      assert.doesNotMatch(html, /href="[^"]*script:|src="[^"]*script:/i);
    }
  });

  test('an unterminated tag cannot absorb the markup after it', () => {
    for (const html of renderBoth('<div>\n<img src=x onerror=alert(1)\n</div>')) {
      assert.doesNotMatch(html, /<img/);
    }
  });

  test('the raw HTML published content uses passes through', () => {
    const html = renderWriteupHtml(
      '<p class="lede">Hi <strong>there</strong> <a href="https://example.com/" target="_blank" rel="noopener">x</a></p>\n\n' +
        '<figure class="f"><img src="/assets/writeups/demo/images/a.png" alt="A &amp; B" class="i"/><figcaption class="c">Cap</figcaption></figure>\n\n' +
        '<h4 class="h">Head</h4>\n\n<pre class="p"><code>code</code></pre>',
    );
    assert.match(html, /<p class="lede">Hi <strong>there<\/strong> <a href="https:\/\/example.com\/" target="_blank" rel="noopener">x<\/a><\/p>/);
    assert.match(html, /<figure class="f"><img src="\/assets\/writeups\/demo\/images\/a.png" alt="A &amp; B" class="i"><figcaption class="c">Cap<\/figcaption><\/figure>/);
    assert.match(html, /<h4 class="h">Head<\/h4>/);
    assert.match(html, /<pre class="p"><code>code<\/code><\/pre>/);
  });

  test('HTML comments are dropped', () => {
    assert.doesNotMatch(renderPageHtml('<!-- note -->\n\nText'), /<!--|note/);
  });
});

