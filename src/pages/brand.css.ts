import type { APIRoute } from 'astro';
import { brandVarsCss } from '@lib/brand.mjs';

// The /brand.css endpoint is the brand-identity surface that loads alongside
// base.css. The CSS it emits is owned by brandVarsCss() so embedders (the
// Obsidian plugin preview) consume the same definition, not a copy.
export const GET: APIRoute = () =>
  new Response(brandVarsCss(), {
    headers: {
      'Content-Type': 'text/css; charset=utf-8',
    },
  });
