declare module 'markdown-it' {
  export default class MarkdownIt {
    renderer: {
      rules: Record<string, (...args: unknown[]) => string>;
    };
    constructor(options?: Record<string, unknown>);
    render(src: string): string;
    renderInline(src: string): string;
  }
}
