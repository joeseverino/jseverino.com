// astro.config.ts passes `processorOptions` to satteri(); tests compile with the same options.
import type { Features, HastPluginList, MdastPluginList } from 'satteri';
import { blocks } from './blocks.ts';
import { contentGuard } from './guard.ts';
import { literalText } from './literal.ts';
import { markup, tableBoxes, tables } from './markup.ts';
import { prose } from './prose.ts';

export { CONTENT_RUN, PLACEHOLDERS } from './blocks.ts';

export const features: Features = { gfm: true, frontmatter: true, directive: true, smartPunctuation: true };

export const processorOptions: { features: Features; mdastPlugins: MdastPluginList; hastPlugins: HastPluginList } = {
  features,
  mdastPlugins: [contentGuard, literalText, blocks, prose],
  hastPlugins: [markup, tables, tableBoxes],
};
