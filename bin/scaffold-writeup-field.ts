#!/usr/bin/env node
// Add one field to the canonical writeup contract. Consumers derive from it; none are patched.
import fs from 'node:fs';
import { cli, flag } from './lib/args.ts';
import type { ContentContract, FieldSpec, FieldType } from '../src/lib/content-contract.ts';
import { fromRoot } from '../src/lib/site-root.ts';
import { readJson } from '../src/lib/json.ts';

const target = fromRoot('contracts/content.v1.json');
const FIELD_TYPES: readonly string[] = ['string', 'boolean', 'date', 'integer', 'string[]', 'image'] satisfies FieldType[];
const TYPE_LIST = FIELD_TYPES.join('|');
const { values } = cli({
  usage: [
    `usage: node bin/scaffold-writeup-field.ts --name <snake_case> [--type ${TYPE_LIST}]`,
    '         [--required] [--editable] [--public] [--ownership <owner>] [--cli-flag <flag>] [--apply]',
  ].join('\n'),
  options: {
    name: { type: 'string' },
    type: { type: 'string', default: 'string' },
    required: flag,
    editable: flag,
    public: flag,
    ownership: { type: 'string' },
    'cli-flag': { type: 'string' },
    apply: flag,
  },
});

const isFieldType = (value: string): value is FieldType => FIELD_TYPES.includes(value);

const { name, type } = values;
if (!name || !/^[a-z][a-z0-9_]*$/.test(name)) {
  console.error('scaffold-writeup-field: --name is required and must be snake_case');
  process.exit(2);
}
if (!isFieldType(type)) {
  console.error(`scaffold-writeup-field: --type must be ${TYPE_LIST}`);
  process.exit(2);
}

const contract = readJson<ContentContract>(target);
const fields = contract.collections.writeups?.fields ?? {};
if (name in fields) {
  console.error(`scaffold-writeup-field: ${name} already exists`);
  process.exit(1);
}
const defaults: Partial<Record<FieldType, FieldSpec['default']>> = { boolean: false, 'string[]': [] };
const spec: FieldSpec = {
  type,
  ...(values.required ? { required: true } : {}),
  ...(type in defaults ? { default: defaults[type] } : {}),
  editable: values.editable,
  public: values.public,
  ...(values.ownership ? { ownership: values.ownership } : {}),
  ...(values['cli-flag'] ? { cli_flag: values['cli-flag'] } : {}),
};

// The contract file keeps one field spec per line.
const inline = (value: object): string =>
  `{ ${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}: ${JSON.stringify(item)}`).join(', ')} }`;
function layout(value: unknown, indent = '', inlineChildren = false): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return JSON.stringify(value);
  const entries = Object.entries(value);
  if (!entries.length) return '{}';
  const inner = `${indent}  `;
  const lines = entries.map(([key, item]) =>
    `${inner}${JSON.stringify(key)}: ${inlineChildren ? inline(item as object) : layout(item, inner, key === 'fields')}`);
  return `{\n${lines.join(',\n')}\n${indent}}`;
}

fields[name] = spec;
const output = `${layout(contract)}\n`;
if (!values.apply) {
  console.log(JSON.stringify({ field: name, spec }, null, 2));
  console.log('dry run; add --apply, then run npm run sync:contract');
  process.exit(0);
}
fs.writeFileSync(target, output);
console.log(`added ${name} to contracts/content.v1.json`);
console.log('run npm run sync:contract to regenerate every typed consumer projection');
