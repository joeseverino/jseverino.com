// The repository root, resolved once. Scripts under bin/ and tests/ import
// this instead of re-deriving it with a hand-counted '..' depth that silently
// breaks when a file moves.
import path from 'node:path';

export const siteRoot = path.resolve(import.meta.dirname, '../..');

export const fromRoot = (...segments: string[]): string => path.join(siteRoot, ...segments);
