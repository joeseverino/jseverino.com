// Resolves writeup URLs from the synced content snapshot instead of pinned slugs, so
// renaming a writeup cannot break the code gates. Picks the alphabetically first match.
// The visual suite does not use these.

import { writeupPath } from '../../../src/lib/site-config.ts';
import { snapshotWriteups } from '../../../src/lib/snapshot.ts';

const writeups = snapshotWriteups();

function writeupWhere(predicate: (body: string) => boolean, description: string): string {
  const match = writeups.find((writeup) => predicate(writeup.source));
  if (!match) {
    throw new Error(`no synced writeup ${description}; run \`npm run sync:content\` and check the vault`);
  }
  return writeupPath(match.slug);
}

export const anyWriteup = () => writeupWhere(() => true, 'exists');


export const tableWriteup = () =>
  writeupWhere((text) => /^::table/m.test(text) || /^\|.+\|$/m.test(text), 'with a table block');

export const imageHeavyWriteup = () => {
  const counted = writeups
    .map(({ slug, source }) => ({ slug, images: (source.match(/!\[/g) ?? []).length }))
    .sort((a, b) => b.images - a.images || a.slug.localeCompare(b.slug));
  const [top] = counted;
  if (!top || top.images === 0) {
    throw new Error('no synced writeup contains images; run `npm run sync:content`');
  }
  return writeupPath(top.slug);
};
