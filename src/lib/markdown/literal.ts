// Directive syntax also defines inline `:name` text directives, which would
// read a MAC address's `:1e` as one. Content never uses them, so each is put
// back as the exact source text it was parsed from. It runs as its own pass:
// a later pass can then move a node whose text this one restored.
import { defineMdastPlugin } from 'satteri';

export const literalText = defineMdastPlugin({
  name: 'literal-text',
  options: { position: true },
  textDirective(node, ctx) {
    const { start, end } = node.position ?? {};
    if (start?.offset === undefined || end?.offset === undefined) return;
    ctx.replaceNode(node, { type: 'text', value: ctx.source.slice(start.offset, end.offset) });
  },
});
