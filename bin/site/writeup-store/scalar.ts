// In-place frontmatter scalar writes preserve the surrounding document.
import { dump, EVENT_ID, getScalarValue, parseEvents, SCALAR_STYLE, type ScalarEvent } from 'js-yaml';
import { FRONTMATTER_SCHEMA, frontmatterBlock } from '../../../src/lib/frontmatter.ts';

export function yamlEscape(value: string): string {
  return dump(value, {
    schema: FRONTMATTER_SCHEMA,
    quoteStyle: 'double',
    lineWidth: -1,
    forceQuotes: /[\r\n]/.test(value),
  }).trimEnd();
}

// null and '' render as a bare key, the null the site build reads.
export function renderScalar(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' && Number.isInteger(value)) return String(value);
  const text = String(value);
  return text === '' ? '' : yamlEscape(text);
}

const quoted = (event: ScalarEvent): number => Number(event.style === SCALAR_STYLE.DOUBLE_QUOTED || event.style === SCALAR_STYLE.SINGLE_QUOTED);

type YamlEvent = ReturnType<typeof parseEvents>[number];

const opensNode = (event: YamlEvent): boolean => event.type === EVENT_ID.DOCUMENT || event.type === EVENT_ID.MAPPING || event.type === EVENT_ID.SEQUENCE;

const keyNamed = (yaml: string, key: string, event: YamlEvent): ScalarEvent | undefined =>
  event.type === EVENT_ID.SCALAR && getScalarValue(yaml, event) === key ? event : undefined;

// A value written in place must be a plain scalar, with no collection, anchor or tag to carry over.
function plainScalar(key: string, event: YamlEvent): ScalarEvent {
  if (event.type !== EVENT_ID.SCALAR || event.anchorStart !== -1 || event.tagStart !== -1) {
    throw new Error(`${key} must be a scalar`);
  }
  return event;
}

// Matches only root keys, so a nested or quoted key is never mistaken for another. The events
// open the document, then the root mapping, so depth counts both and the root's entries sit at
// depth 2, where they alternate key and value.
function rootField(yaml: string, key: string): { key: ScalarEvent; value: ScalarEvent } | undefined {
  const events = parseEvents(yaml, {});
  if (events[1]?.type !== EVENT_ID.MAPPING) return undefined;
  let depth = 0;
  let entries = 0;
  let current: ScalarEvent | undefined;
  for (const event of events) {
    if (event.type === EVENT_ID.POP) {
      depth -= 1;
      continue;
    }
    if (depth === 2) {
      if (entries % 2 === 0) current = keyNamed(yaml, key, event);
      else if (current) return { key: current, value: plainScalar(key, event) };
      entries += 1;
    }
    if (opensNode(event)) depth += 1;
  }
  return undefined;
}

// YAML event offsets include multiline scalar content without consuming adjacent fields.
export function replaceScalar(text: string, key: string, rendered: string): string {
  const block = frontmatterBlock(text);
  if (!block?.closed) throw new Error('scalar updates require fenced frontmatter');
  // With the closing fence's line break, every YAML line ends in one.
  const yaml = `${block.yaml}\n`;
  const { yamlStart } = block;
  const line = `${key}: ${rendered}`.trimEnd();
  const field = rootField(yaml, key);
  let next: string;
  if (field) {
    const start = field.key.valueStart - quoted(field.key);
    const colon = yaml.indexOf(':', field.key.valueEnd + quoted(field.key));
    const empty = /^[ \t]*/.exec(yaml.slice(colon + 1))?.[0].length ?? 0;
    const end = field.value.valueEnd < 0 ? colon + 1 + empty : field.value.valueEnd + quoted(field.value);
    const newline = yaml.slice(start, end).endsWith('\n') ? (yaml.includes('\r\n') ? '\r\n' : '\n') : '';
    next = yaml.slice(0, start) + line + newline + yaml.slice(end);
  } else {
    next = yaml + line + (yaml.includes('\r\n') ? '\r\n' : '\n');
  }
  return text.slice(0, yamlStart) + next + text.slice(yamlStart + yaml.length);
}

// Apply updates in order; a field counts as changed only when its line changes.
export function applyScalars(text: string, updates: Record<string, unknown>): { text: string; changed: string[] } {
  let current = text;
  const changed: string[] = [];
  for (const [key, value] of Object.entries(updates)) {
    const next = replaceScalar(current, key, renderScalar(value));
    if (next !== current) {
      changed.push(key);
      current = next;
    }
  }
  return { text: current, changed: changed.sort() };
}
