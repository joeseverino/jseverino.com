// Inline `:name` text directives would read a MAC address's `:1e` as one; restore the source text.
// Its own pass, so a later pass can move a node whose text this one restored.
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
