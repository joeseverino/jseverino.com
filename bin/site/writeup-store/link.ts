// Rewrites one link in a writeup's body, refused unless exactly one link matches.
import { readFileSync } from 'node:fs';
import { commit } from './plan.ts';
import { type MutationReceipt, receipt } from './receipt.ts';
import { findWriteup, loadWriteups, WriteupError, type WriteupStore } from './store.ts';

export interface LinkResult {
  slug: string;
  label: string;
  oldHref: string;
  newHref: string;
  receipt: MutationReceipt;
}

const isHttpUrl = (href: string): boolean => {
  try {
    const url = new URL(href);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.host !== '';
  } catch {
    return false;
  }
};

// Replace the one `[label](href)` in a writeup body whose label and href match.
export function updateLink(store: WriteupStore, slug: string, label: string, expectedHref: string, replacementHref: string): LinkResult {
  const writeup = findWriteup(loadWriteups(store), slug);
  if (!label.trim()) throw new WriteupError('invalid', 'link label required');
  for (const [name, href] of [
    ['expected', expectedHref],
    ['replacement', replacementHref],
  ] as const) {
    if (!isHttpUrl(href)) throw new WriteupError('invalid', `${name} href must be an absolute HTTP(S) URL`);
  }
  const text = readFileSync(writeup.path, 'utf8');
  const pattern = new RegExp(`\\[${RegExp.escape(label)}\\]\\(${RegExp.escape(expectedHref)}(\\s+"[^"]*")?\\)`, 'g');
  const matches = text.match(pattern) ?? [];
  if (matches.length !== 1) throw new WriteupError('invalid', `expected exactly one matching link; found ${matches.length}`);
  const next = text.replace(pattern, (_match, title: string | undefined) => `[${label}](${replacementHref}${title ?? ''})`);
  commit(new Map([[writeup.path, { before: text, after: next }]]));
  return {
    slug,
    label,
    oldHref: expectedHref,
    newHref: replacementHref,
    receipt: receipt({
      operation: 'writeup.link.update',
      entityType: 'writeup',
      entityId: slug,
      changedFields: ['body.link'],
      after: { slug, href: replacementHref },
      affectedProjections: ['site', 'writeup_dashboard'],
      metadata: { label },
    }),
  };
}
