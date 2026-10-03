#!/usr/bin/env node
// Structural HTML assertions over every built page: the static, all-pages
// complement to the axe accessibility sweep (which runs deeper rules but only
// on key pages in the browser suite). Three invariants, checked in bytes:
//
//   • no duplicate id attributes on a page (breaks fragment links, label
//     association, and aria-* references silently)
//   • every <img> carries an alt attribute (empty alt marks a decorative
//     image; a missing attribute is an authoring bug)
//   • no literal `::name` directive in the page text: a typo (::termnial) or a
//     directive the page's pipeline does not render reaches readers verbatim

import { builtPages, finish } from './lib.ts';

// Text a reader sees: tags, comments, and the elements whose contents are code
// or markup (where `::` is legitimate, e.g. `std::vector` or `::before`) removed.
const visibleText = (html: string): string =>
  html
    .replace(/<!--[\s\S]*?-->/g, '\n')
    .replace(/<(script|style|pre|code|textarea|template)\b[\s\S]*?<\/\1>/gi, '\n')
    .replace(/<[^>]*>/g, '\n');

// Each unprocessed directive name, in order. A directive starts a word:
// `a::b` and `::1` are not directives.
export function directiveLeaks(html: string): string[] {
  return [...visibleText(html).matchAll(/(?:^|\s)::([a-z][a-z0-9-]*)/gim)].map(([, name = '']) => name);
}

export function duplicateIds(html: string): { ids: number; repeated: [string, number][] } {
  const seen = new Map<string, number>();
  let ids = 0;
  for (const [, id = ''] of html.matchAll(/<[a-zA-Z][^>]*\sid="([^"]*)"/g)) {
    ids += 1;
    seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  return { ids, repeated: [...seen].filter(([, count]) => count > 1) };
}

if (import.meta.main) {
  const { pages } = builtPages('check-html');
  const problems: string[] = [];
  let idCount = 0;
  let imgCount = 0;

  for (const { rel, html } of pages) {
    const { ids, repeated } = duplicateIds(html);
    idCount += ids;
    for (const [id, count] of repeated) problems.push(`${rel}: id "${id}" appears ${count} times`);

    for (const match of html.matchAll(/<img\b[^>]*>/g)) {
      imgCount += 1;
      if (!/\salt=/.test(match[0])) {
        problems.push(`${rel}: <img> without an alt attribute (${match[0].slice(0, 80)}…)`);
      }
    }

    for (const name of directiveLeaks(html)) {
      problems.push(`${rel}: unprocessed directive "::${name}" (a typo, or a directive this page's renderer does not support)`);
    }
  }

  finish(problems, `${pages.length} pages: ${idCount} ids unique per page, ${imgCount} images all carry alt, no unprocessed directives`, {
    heading: 'check-html: structural problems in the built HTML:',
  });
}
