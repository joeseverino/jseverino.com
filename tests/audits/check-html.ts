// No literal `::name` directive reaches a built page's text. Ids, alt text, and heading levels are
// html-validate's (.htmlvalidate.json), which runs first in the same gate.

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

if (import.meta.main) {
  const { pages } = builtPages('check-html');
  const problems: string[] = [];

  for (const { rel, html } of pages) {
    for (const name of directiveLeaks(html)) {
      problems.push(`${rel}: unprocessed directive "::${name}" (a typo, or a directive this page's renderer does not support)`);
    }
  }

  finish(problems, `${pages.length} pages: no unprocessed directives`, {
    heading: 'check-html: directives leaked into the built HTML:',
    fix: 'fix: correct the directive in the content at the reported page; a leaked directive is a typo or one the page\'s renderer does not support',
  });
}
