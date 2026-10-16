// In-place frontmatter scalar writes preserve the surrounding document.
import { dump, EVENT_ID, getScalarValue, parseEvents, SCALAR_STYLE, type ScalarEvent } from 'js-yaml';
import { FRONTMATTER_SCHEMA } from '../../../src/lib/frontmatter.ts';

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

const quoted = (event: ScalarEvent): number =>
  Number(event.style === SCALAR_STYLE.DOUBLE_QUOTED || event.style === SCALAR_STYLE.SINGLE_QUOTED);

// Matches only root keys, so a nested or quoted key is never mistaken for another.
function rootField(yaml: string, key: string): { key: ScalarEvent; value: ScalarEvent } | undefined {
  let depth = 0;
  let isKey = true;
  let current: ScalarEvent | undefined;
  for (const event of parseEvents(yaml, {})) {
    if (event.type === EVENT_ID.DOCUMENT) continue;
    if (event.type === EVENT_ID.POP) {
      depth -= 1;
      if (depth === 1) isKey = true;
      continue;
    }
    const opens = event.type === EVENT_ID.MAPPING || event.type === EVENT_ID.SEQUENCE;
    if (depth === 0 && opens && event.type !== EVENT_ID.MAPPING) break;
    if (depth === 1) {
      if (isKey) {
        current = event.type === EVENT_ID.SCALAR && getScalarValue(yaml, event) === key ? event : undefined;
        isKey = false;
      } else if (current) {
        if (event.type !== EVENT_ID.SCALAR || event.anchorStart !== -1 || event.tagStart !== -1) {
          throw new Error(`${key} must be a scalar`);
        }
        return { key: current, value: event };
      } else if (!opens) {
        isKey = true;
      }
    }
    if (opens) depth += 1;
  }
  return undefined;
}

// YAML event offsets include multiline scalar content without consuming adjacent fields.
export function replaceScalar(text: string, key: string, rendered: string): string {
  const block = /^(\uFEFF?---\r?\n)([\s\S]*?)(^---[ \t]*(?:\r?\n|$))/m.exec(text);
  if (!block || block.index !== 0) throw new Error('scalar updates require fenced frontmatter');
  const yaml = block[2] ?? '';
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
  const start = block[1]?.length ?? 0;
  return text.slice(0, start) + next + text.slice(start + yaml.length);
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
