// The repository root. Import this instead of counting '..', which breaks when a file moves.
import path from 'node:path';

export const siteRoot = path.resolve(import.meta.dirname, '../..');

export const fromRoot = (...segments: string[]): string => path.join(siteRoot, ...segments);
