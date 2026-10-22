import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { storeCspReports } from '../../lib/api/csp-report.ts';

export const prerender = false;

export const POST: APIRoute = ({ request }) => storeCspReports(request, env.DB);
