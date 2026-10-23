import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { storeCspReports } from '../../lib/api/csp-report.ts';

export const prerender = false;

export const POST: APIRoute = ({ request }) => storeCspReports(request, env.DB);
