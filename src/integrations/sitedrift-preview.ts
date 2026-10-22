// sitedrift's review proxy at /__sitedrift/*. Astro skips page files whose names start with `_`,
// so the route is injected rather than placed under src/pages/.
import type { AstroIntegration } from 'astro';

export const sitedriftPreview = (): AstroIntegration => ({
  name: 'sitedrift-preview',
  hooks: {
    'astro:config:setup': ({ injectRoute }) => {
      injectRoute({ pattern: '/__sitedrift/[...path]', entrypoint: new URL('./sitedrift-route.ts', import.meta.url), prerender: false });
    },
  },
});
