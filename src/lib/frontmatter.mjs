import matter from 'gray-matter';
import { dump, load } from 'js-yaml';

const matterOptions = {
  engines: {
    yaml: {
      parse(value) {
        return load(value) ?? {};
      },
      stringify(value) {
        return dump(value);
      },
    },
  },
};

export function parseFrontmatter(markdown) {
  return matter(markdown, matterOptions);
}

export function stringifyFrontmatter(markdown, data) {
  return matter.stringify(markdown, data, matterOptions);
}
