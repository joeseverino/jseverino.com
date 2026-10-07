#!/usr/bin/env node
// Structural HTML checks over every built page: no duplicate ids, every <img> has alt, no skipped
// heading levels, no literal `::name` directive in the page text.

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

const headingText = (inner: string): string =>
  [...inner.matchAll(/(?:^|>)([^<>]+)/g)].map(([, text = '']) => text.trim()).filter(Boolean).join(' ').slice(0, 40);

// Headings that jump more than one level deeper; the first counts as following level 0.
export function headingSkips(html: string): string[] {
  const skips: string[] = [];
  let previous = 0;
  for (const [, digit = '', inner = ''] of html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const level = Number(digit);
    if (level > previous + 1) skips.push(`h${previous || 'start'} -> h${level} "${headingText(inner)}"`);
    previous = level;
  }
  return skips;
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
      // A bare `alt` is the empty alt, as `alt=""` is.
      if (!/\salt(?:=|[\s/>])/.test(match[0])) {
        problems.push(`${rel}: <img> without an alt attribute (${match[0].slice(0, 80)}…)`);
      }
    }

    for (const skip of headingSkips(html)) problems.push(`${rel}: heading level skipped, ${skip}`);

    for (const name of directiveLeaks(html)) {
      problems.push(`${rel}: unprocessed directive "::${name}" (a typo, or a directive this page's renderer does not support)`);
    }
  }

  finish(problems, `${pages.length} pages: ${idCount} ids unique per page, ${imgCount} images all carry alt, headings never skip a level, no unprocessed directives`, {
    heading: 'check-html: structural problems in the built HTML:',
  });
}
