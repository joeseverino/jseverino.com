import matter from 'gray-matter';
import yaml from 'js-yaml';

const matterOptions = {
  engines: {
    yaml: {
      parse(value) {
        return yaml.load(value) ?? {};
      },
      stringify(value) {
        return yaml.dump(value);
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
