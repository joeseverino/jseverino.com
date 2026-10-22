import { bundle } from 'lightningcss';

// A stylesheet entry with every @import inlined in cascade order. Comments are dropped.
export function readCssEntry(entryPath: string): string {
  return bundle({ filename: entryPath }).code.toString();
}
