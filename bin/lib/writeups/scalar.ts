// In-place frontmatter scalar writes: replace one `key:` line, leave every other byte alone. Quoting follows the vault's YAML subset.

const YAML_SPECIAL = [':', '#', '@', '|', '>', '{', '}', '[', ']', ',', '&', '*', '!', '%', '`'];

export function yamlEscape(value: string): string {
  if (value === '') return '""';
  if (YAML_SPECIAL.some((char) => value.includes(char))) return `"${value.replaceAll('"', '\\"')}"`;
  if (value.trim() !== value) return `"${value}"`;
  return value;
}

// null and '' render as a bare key, the null the site build reads.
export function renderScalar(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' && Number.isInteger(value)) return String(value);
  const text = String(value);
  return text === '' ? '' : yamlEscape(text);
}


// Replace the first `key:` line, or insert one before the closing fence.
export function replaceScalar(text: string, key: string, rendered: string): string {
  const line = `${key}: ${rendered}`.trimEnd();
  const pattern = new RegExp(`^${RegExp.escape(key)}:[^\\n]*$`, 'm');
  if (pattern.test(text)) return text.replace(pattern, () => line);
  const lines = text.split('\n');
  let fences = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.trim() !== '---') continue;
    fences += 1;
    if (fences === 2) {
      lines.splice(index, 0, line);
      return lines.join('\n');
    }
  }
  return `${line}\n${text}`;
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
