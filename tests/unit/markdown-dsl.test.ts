// Unit tests for the custom Markdown DSL in src/lib/markdown.ts.
//
// These run without a browser or a build: markdown in, HTML out. They double as
// executable documentation of the block grammar (::terminal, ::figure, ::table,
// ::split, ::buttons, ::center, ::hero) and the inline rewrites (private-link
// tooltips, standalone-link buttons, image directives, writeup chrome stripping).
//
//   npm run test:unit
//
// renderPageHtml drives the page directives; renderWriteupHtml drives the writeup
// pipeline (chrome strip + slug-relative asset rewriting). Image <picture>
// enhancement is layered on in content.ts and is intentionally out of scope here.

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
});

describe('::buttons', () => {
  test('marks the first link primary and the rest secondary', () => {
    const html = renderPageHtml('::buttons\n- [First](/a/)\n- [Second](/b/)\n::');
    assert.match(html, /<a class="button" href="\/a\/">First<\/a>/);
    assert.match(html, /<a class="button secondary" href="\/b\/">Second<\/a>/);
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

describe('private-link tooltips', () => {
  test('rewrites a `private:` link title into a data-private-tooltip attribute', () => {
    const html = renderPageHtml('[HQ](https://hq.example "private: tailnet only")');
    assert.match(html, /data-private-tooltip="tailnet only"/);
    assert.doesNotMatch(html, /title="private:/);
  });
});

describe('::figure (writeup)', () => {
  test('builds a figure with the trailing line as its caption', () => {
    const html = renderWriteupHtml('::figure\n![A cat](cat.png)\nA caption here\n::', 'demo');
    assert.match(html, /<figure><img src="cat\.png" alt="A cat"><figcaption>A caption here<\/figcaption><\/figure>/);
  });

  test('falls back to plain rendering when the block has no image line', () => {
    const html = renderWriteupHtml('::figure\nnot an image line\n::', 'demo');
    assert.match(html, /<p>not an image line<\/p>/);
    assert.doesNotMatch(html, /<figure>/);
  });

  test('honors a |nozoom modifier on the figure image', () => {
    const html = renderWriteupHtml('::figure\n![A cat|nozoom](cat.png)\nA caption here\n::', 'demo');
    assert.match(html, /<figure><img src="cat\.png" alt="A cat" data-no-zoom><figcaption>A caption here<\/figcaption><\/figure>/);
  });
});

describe('::table (writeup)', () => {
  test('wraps the table in a table-figure and renders the trailing caption', () => {
    const html = renderWriteupHtml('::table\n| A | B |\n| - | - |\n| 1 | 2 |\nTable caption\n::', 'demo');
    assert.match(html, /<figure class="table-figure"><div class="table-box"><table>/);
    assert.match(html, /<th>A<\/th>/);
    assert.match(html, /<figcaption>Table caption<\/figcaption>/);
  });

  test('falls back to plain rendering when the block has no table rows', () => {
    const html = renderWriteupHtml('::table\njust a caption\n::', 'demo');
    assert.match(html, /<p>just a caption<\/p>/);
    assert.doesNotMatch(html, /table-figure/);
  });
});

describe('image directives (writeup)', () => {
  // markdown.ts parses the `alt|width|nocap` directive into <img> attributes;
  // the <figure>/<picture> wrapping is assembled downstream in enhanceImages.
  test('`alt|width` parses the width into an attribute and flags the alt caption', () => {
    const html = renderWriteupHtml('![A cat|320](photo.png)', 'demo');
    assert.match(html, /<img src="photo\.png" alt="A cat" width="320" data-has-alt-caption>/);
  });

  test('a plain image without a directive stays an inline paragraph image', () => {
    const html = renderWriteupHtml('![A cat](photo.png)', 'demo');
    assert.match(html, /<p><img src="photo\.png" alt="A cat"><\/p>/);
  });

  test('`nocap` with alt text flags both data-nocap and data-has-alt-caption', () => {
    const html = renderWriteupHtml('![A cat|nocap](photo.png)', 'demo');
    assert.match(html, /<img src="photo\.png" alt="A cat" data-nocap data-has-alt-caption>/);
  });

  test('`nocap` with empty alt flags data-nocap only', () => {
    const html = renderWriteupHtml('![|nocap](photo.png)', 'demo');
    assert.match(html, /<img src="photo\.png" alt="" data-nocap>/);
  });

  test('`nozoom` flags data-no-zoom so the image opts out of the lightbox', () => {
    const html = renderWriteupHtml('![A cat|nozoom](photo.png)', 'demo');
    assert.match(html, /<img src="photo\.png" alt="A cat" data-no-zoom data-has-alt-caption>/);
  });
});

describe('fenced code (writeup)', () => {
  test('tags a fenced block with its markdown-it language class', () => {
    const html = renderWriteupHtml('```bash\nls -la\n```', 'demo');
    assert.match(html, /<pre><code class="language-bash">ls -la\n<\/code><\/pre>/);
  });
});

describe('standalone links (writeup)', () => {
  test('a link alone in a paragraph is promoted to an action button', () => {
    const html = renderWriteupHtml('[Download the PDF](https://example.com/file.pdf)', 'demo');
    assert.match(html, /<div class="actions"><a class="button" href="https:\/\/example\.com\/file\.pdf">Download the PDF<\/a><\/div>/);
  });
});

describe('writeup chrome + asset paths', () => {
  test('strips a leading H1 so the article title is not duplicated', () => {
    const html = renderWriteupHtml('# Building a Homelab\n\nReal body text.', 'demo');
    assert.doesNotMatch(html, /<h1>/);
    assert.match(html, /Real body text\./);
  });

  test('strips a leading blockquote lede', () => {
    const html = renderWriteupHtml('> A short lede.\n\nReal body text.', 'demo');
    assert.doesNotMatch(html, /<blockquote>/);
    assert.match(html, /<p>Real body text\.<\/p>/);
  });

  test('strips a leading hero image so it is not repeated in the body', () => {
    const html = renderWriteupHtml('![hero](cover.png)\n\nReal body text.', 'demo');
    assert.doesNotMatch(html, /cover\.png/);
    assert.match(html, /<p>Real body text\.<\/p>/);
  });

  test('rewrites relative ./images paths to the published writeup asset folder', () => {
    const html = renderWriteupHtml('![pic](./images/diagram.png)', 'building-a-homelab');
    assert.match(html, /src="\/assets\/writeups\/building-a-homelab\/images\/diagram\.png"/);
  });
});
