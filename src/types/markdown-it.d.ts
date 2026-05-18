declare module 'markdown-it' {
  export default class MarkdownIt {
    constructor(options?: Record<string, unknown>);
    render(src: string): string;
  }
}
