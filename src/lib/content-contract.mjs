import fs from 'node:fs';
import crypto from 'node:crypto';

const contractUrl = new URL('../../contracts/content.v1.json', import.meta.url);

export const contentContract = JSON.parse(fs.readFileSync(contractUrl, 'utf8'));

export function collectionFields(name) {
  const fields = contentContract.collections?.[name]?.fields;
  if (!fields || typeof fields !== 'object') {
    throw new Error(`Unknown content contract collection: ${name}`);
  }
  return fields;
}

export function projectFrontmatter(name, data) {
  const projected = {};
  for (const [field, spec] of Object.entries(collectionFields(name))) {
    if (spec.public !== true) continue;
    const value = data[field];
    if (value !== undefined && value !== null && value !== '') {
      projected[field] = value;
    } else if ('default' in spec) {
      projected[field] = structuredClone(spec.default);
    }
  }
  return projected;
}

export function canonicalContractJson(contract = contentContract) {
  const sort = (value) => {
    if (Array.isArray(value)) return value.map(sort);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sort(value[key])]));
    }
    return value;
  };
  return JSON.stringify(sort(contract));
}

export function contentContractFingerprint(contract = contentContract) {
  return crypto.createHash('sha256').update(canonicalContractJson(contract)).digest('hex');
}
