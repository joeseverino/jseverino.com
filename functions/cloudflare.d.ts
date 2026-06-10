// Ambient declarations for Cloudflare-runtime globals the Workers `WebWorker`
// lib does not know about. Only the surface this codebase touches — narrower
// than @cloudflare/workers-types on purpose, so the type gate carries zero
// extra dependencies.

declare module 'sitedrift/cloudflare' {
  export function onRequest(context: { request: Request; next(): Promise<Response> }): Promise<Response>;
}

declare class HTMLRewriter {
  on(
    selector: string,
    handler: { element(element: { setAttribute(name: string, value: string): void }): void },
  ): HTMLRewriter;
  transform(response: Response): Response;
}
