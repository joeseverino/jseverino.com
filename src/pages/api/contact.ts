import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { submitContact } from '../../lib/api/contact.ts';

export const prerender = false;

export const POST: APIRoute = ({ request }) => submitContact(request, env);
