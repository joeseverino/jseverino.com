// The repository root, resolved once. Scripts under bin/ and tests/ import
// this instead of re-deriving it from import.meta.url with a hand-counted
// '..' depth that silently breaks when a file moves.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const fromRoot = (...segments) => path.join(siteRoot, ...segments);
