// Cloudflare's v4 API for the bin/ scripts: one client over the REST core. Paths are templates
// (`:zone`, `:account`, mid-apply ids) resolved at each call, so output never prints an id.
import dns from 'node:dns';
import type { ApiPayload } from './cloudflare-types.ts';
import type { Method } from './drift.ts';
import { absentOn404, type ClientOptions, createSend, jsonBody, RestError } from './rest.ts';

// A token's client IP filter lists IPv4 addresses, and Node's fetch tries the first address
// dns.lookup returns, which is IPv6 on a dual-stack network unless this order says otherwise.
dns.setDefaultResultOrder('ipv4first');

export const API_BASE = 'https://api.cloudflare.com/client/v4';

export type Client = ReturnType<typeof createClient>;

const errorDetail = ({ errors = [] }: ApiPayload<unknown>): string => errors.map((error) => `${error.code ?? ''} ${error.message ?? ''}`.trim()).join('; ');

export function createClient({ token, fetch }: ClientOptions) {
  const send = createSend<ApiPayload<unknown>>({ token, noToken: 'CLOUDFLARE_API_TOKEN is not set', fetch, detail: errorDetail });
  const ids: Record<string, string> = {};
  const resolve = (template: string) =>
    template.replace(/:([a-z]+)/g, (_, name: string) => {
      const id = ids[name];
      if (id === undefined) throw new Error(`${template}: no ${name} id resolved yet`);
      return encodeURIComponent(id);
    });

  // Response bodies are trusted to carry the documented v4 shape; nothing validates them. An error
  // is labeled by the template, so it never prints a resolved id.
  async function request<T>(method: Method, template: string, body?: unknown): Promise<ApiPayload<T>> {
    const response = await send(method, `${API_BASE}${resolve(template)}`, template, body);
    const payload = (await jsonBody<ApiPayload<T>>(response)) ?? {};
    if (payload.success === false) throw new RestError(method, template, response.status, errorDetail(payload));
    return payload;
  }
  const get = async <T>(template: string): Promise<T> => (await request<T>('GET', template)).result as T;

  return {
    ids,
    request,
    get,
    // A missing ruleset entrypoint (or setting) answers 404, which reads as absent.
    maybe: <T>(template: string): Promise<T | null> => absentOn404(get<T>(template)),
    async list<T>(template: string): Promise<T[]> {
      const results: T[] = [];
      for (let page = 1; ; page += 1) {
        const separator = template.includes('?') ? '&' : '?';
        const payload = await request<T[]>('GET', `${template}${separator}page=${page}&per_page=50`);
        results.push(...(payload.result ?? []));
        const info = payload.result_info;
        if (!info || page >= (info.total_pages ?? 1) || (payload.result ?? []).length < 50) return results;
      }
    },
  };
}
