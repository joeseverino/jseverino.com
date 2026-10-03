// Ambient declarations for Cloudflare-runtime globals the Workers `WebWorker`
// lib does not know about. Only the surface this code touches, narrower than
// @cloudflare/workers-types on purpose, so the type gate adds no dependency.

declare class HTMLRewriter {
  on(
    selector: string,
    handler: { element(element: { setAttribute(name: string, value: string): void }): void },
  ): HTMLRewriter;
  transform(response: Response): Response;
}
