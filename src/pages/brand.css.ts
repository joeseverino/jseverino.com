import type { APIRoute } from 'astro';
import { BRAND } from '@lib/brand.mjs';

export const GET: APIRoute = () =>
  new Response(
    `:root{--color-primary:${BRAND.navy};--color-primary-deep:${BRAND.navyDeep}}`,
    {
      headers: {
        'Content-Type': 'text/css; charset=utf-8',
      },
    },
  );
