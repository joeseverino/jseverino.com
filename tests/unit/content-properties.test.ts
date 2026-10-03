// Property tests for the content renderer's security and fidelity invariants:
// fast-check generates inputs and shrinks any counterexample to the smallest
// one. Each property states what must hold for every input, not one example.
//
//   npm run test:unit

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { htmlToHast, type HastNode } from 'satteri';
import { isSafeUrl, RAW_HTML_TAGS } from '../../src/lib/markdown/guard.ts';
import { compile, html } from './helpers/render.ts';

const RUNS = { numRuns: 300 };
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto']);

const scheme = fc.stringMatching(/^[a-z][a-z0-9+.-]{0,11}$/);
// The same scheme as an attacker might spell it: mixed case, padded.
const respelled = (value: string) =>
  fc.tuple(fc.array(fc.boolean(), { minLength: value.length, maxLength: value.length }), fc.constantFrom('', ' ', '\t', '\n '))
    .map(([upper, pad]) => pad + [...value].map((char, index) => (upper[index] ? char.toUpperCase() : char)).join(''));

// Rendered HTML parsed back into a tree, so assertions read text nodes and
// elements, never markup.
type Element = Extract<HastNode, { type: 'element' }>;
const tree = (markup: string): HastNode => htmlToHast(markup, { fragment: true });
const childrenOf = (node: HastNode): HastNode[] => ('children' in node ? (node.children as HastNode[]) : []);
const textOf = (node: HastNode): string => (node.type === 'text' ? node.value : childrenOf(node).map(textOf).join(''));
const elements = (node: HastNode, tagName: string): Element[] => [
  ...(node.type === 'element' && node.tagName === tagName ? [node] : []),
  ...childrenOf(node).flatMap((child) => elements(child, tagName)),
];

describe('URL schemes', () => {
  test('a URL is safe exactly when it is relative or http(s)/mailto, however it is spelled', () => {
    fc.assert(fc.property(scheme.chain((name) => respelled(name).map((spelling) => [name, spelling] as const)), fc.webPath(), ([name, spelling], rest) => {
      assert.equal(isSafeUrl(`${spelling}:${rest}`), SAFE_SCHEMES.has(name));
    }), RUNS);
  });

  test('a link or a reference definition with an unsafe scheme never compiles', () => {
    const url = fc.tuple(scheme.filter((name) => !SAFE_SCHEMES.has(name)), fc.webPath()).map(([name, rest]) => `${name}:${rest.replace(/[<>\s]/g, '') || 'x'}`);
    fc.assert(fc.property(url, (target) => {
      assert.throws(() => compile(`[x](<${target}>)`), /scheme other than/);
      assert.throws(() => compile(`[x][r]\n\n[r]: <${target}>`), /scheme other than/);
    }), RUNS);
  });

  test('relative paths are always safe', () => {
    fc.assert(fc.property(fc.webPath(), (path) => assert.ok(isSafeUrl(path) || /^[a-z][a-z\d+.-]*:/i.test(path))), RUNS);
  });
});

describe('raw HTML', () => {
  test('a tag compiles exactly when it is on the allow-list', () => {
    const dangerous = fc.constantFrom('script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'form', 'input', 'link', 'meta', 'base', 'video', 'audio', 'template');
    const tag = fc.oneof(fc.constantFrom(...RAW_HTML_TAGS), dangerous, fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/));
    fc.assert(fc.property(tag, (name) => {
      const markup = `<${name}>x</${name}>`;
      if (RAW_HTML_TAGS.has(name)) compile(markup);
      else assert.throws(() => compile(markup), /is not allowed in content/);
    }), RUNS);
  });

  test('an event handler attribute never compiles, on any tag, in any case', () => {
    const handler = fc.stringMatching(/^[a-z]{2,10}$/).chain((event) => respelled(`on${event}`).map((name) => name.trim()));
    fc.assert(fc.property(fc.constantFrom(...RAW_HTML_TAGS), handler, (tag, name) => {
      assert.throws(() => compile(`<${tag} ${name}="x()">y</${tag}>`), /is not allowed on/);
    }), RUNS);
  });

  test('braces in prose never become code: they compile only when escaped', () => {
    fc.assert(fc.property(fc.stringMatching(/^[a-z0-9 +*]{1,20}$/), (inner) => {
      assert.throws(() => compile(`Value {${inner}} here.`));
      compile(`Value \\{${inner}\\} here.`);
    }), RUNS);
  });
});

describe('text fidelity', () => {
  test('colon-separated text (MACs, host:port, ratios) renders exactly as written', () => {
    const word = fc.stringMatching(/^[a-z0-9]{1,6}$/);
    const token = fc.array(word, { minLength: 1, maxLength: 6 }).map((parts) => parts.join(':'));
    fc.assert(fc.property(fc.array(token, { minLength: 1, maxLength: 6 }), (tokens) => {
      const sentence = `Seen ${tokens.join(' and ')} today.`;
      assert.equal(textOf(tree(html(sentence))).trim(), sentence);
    }), RUNS);
  });

  test('break opportunities in table cells never change the text', () => {
    const cell = fc.array(fc.stringMatching(/^[a-z0-9]{1,4}$/), { minLength: 1, maxLength: 6 })
      .chain((parts) => fc.constantFrom('.', ':').map((separator) => parts.join(separator)));
    fc.assert(fc.property(fc.array(cell, { minLength: 1, maxLength: 4 }), (cells) => {
      const table = `| ${cells.map((_, index) => `C${index}`).join(' | ')} |\n| ${cells.map(() => '---').join(' | ')} |\n| ${cells.join(' | ')} |`;
      assert.deepEqual(elements(tree(html(table)), 'td').map(textOf), cells);
    }), RUNS);
  });

  test('terminal output is shown literally: markup in it never becomes markup', () => {
    const line = fc.string({ unit: fc.constantFrom('a', 'b', '<', '>', '&', '"', "'", ' ', '/', '$', 'x'), maxLength: 30 });
    fc.assert(fc.property(fc.array(line, { minLength: 1, maxLength: 5 }), (lines) => {
      const body = lines.map((value) => value.replace(/`/g, '')).join('\n');
      const [code] = elements(tree(html(`\`\`\`terminal\n${body}\n\`\`\``)), 'code');
      assert.ok(code, 'the terminal block has a code element');
      const inside = childrenOf(code).flatMap(function all(node: HastNode): HastNode[] { return [node, ...childrenOf(node).flatMap(all)]; });
      for (const node of inside) if (node.type === 'element') assert.equal(node.tagName, 'span');
      assert.equal(textOf(code), lines.map((value) => value.replace(/`/g, '')).map((value) => value.replace(/^\$\s?/, '$ ') || ' ').join(''));
    }), RUNS);
  });
});
