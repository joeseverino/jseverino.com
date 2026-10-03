// Inline conventions: image alt text carries display modifiers
// (`![alt|400|nozoom](…)`), and in a writeup a paragraph that is only a link
// renders as a button.
import { defineMdastPlugin } from 'satteri';
import { parseImageDirectives } from '../image-directives.ts';

const isWriteup = (url: URL | undefined): boolean => url?.pathname.includes('/writeups/') ?? false;

export const prose = defineMdastPlugin({
  name: 'prose',
  image(node, ctx) {
    const { alt, width, noZoom } = parseImageDirectives(node.alt ?? '');
    if (alt === node.alt && !width && !noZoom) return;
    ctx.setProperty(node, 'alt', alt);
    ctx.setProperty(node, 'data', {
      hProperties: { ...(width ? { width: Number(width) } : {}), ...(noZoom ? { 'data-no-zoom': '' } : {}) },
    });
  },
  paragraph(node, ctx) {
    if (!isWriteup(ctx.fileURL) || node.children.length !== 1) return;
    const [link] = node.children;
    if (link?.type !== 'link' || !link.children.every((child) => child.type === 'text')) return;
    if (ctx.parent(node)?.type !== 'root') return;
    ctx.replaceNode(node, {
      type: 'actions',
      data: { hName: 'div', hProperties: { className: ['actions'] } },
      children: [{ ...link, data: { hProperties: { className: ['button'] } } }],
    } as never);
  },
});
