#!/usr/bin/env node
// Add one field to the canonical writeup contract. Consumers derive from it; none are patched.
import fs from 'node:fs';
import { cli, flag } from './lib/args.ts';
import type { ContentContract, FieldSpec, FieldType } from '../src/lib/content-contract.ts';
import { fromRoot } from '../src/lib/site-root.ts';
import { readJson } from '../src/lib/json.ts';

const target = fromRoot('contracts/content.v1.json');
const { values } = cli({
  usage: [
    'usage: node bin/scaffold-writeup-field.ts --name <snake_case> [--type string|boolean|date|integer|string[]]',
    '         [--required] [--editable] [--public] [--ownership vault] [--cli-flag <flag>] [--apply]',
  ].join('\n'),
  options: {
    name: { type: 'string' },
    type: { type: 'string', default: 'string' },
    required: flag,
    editable: flag,
    public: flag,
    ownership: { type: 'string', default: 'vault' },
    'cli-flag': { type: 'string' },
    apply: flag,
  },
});

const FIELD_TYPES: readonly string[] = ['string', 'boolean', 'date', 'integer', 'string[]', 'image'] satisfies FieldType[];
const isFieldType = (value: string): value is FieldType => FIELD_TYPES.includes(value);

const { name, type } = values;
if (!name || !/^[a-z][a-z0-9_]*$/.test(name)) {
  console.error('scaffold-writeup-field: --name is required and must be snake_case');
  process.exit(2);
}
if (!isFieldType(type)) {
  console.error('scaffold-writeup-field: --type must be string|boolean|date|integer|string[]');
  process.exit(2);
}

const contract = readJson<ContentContract>(target);
const fields = contract.collections.writeups?.fields ?? {};
if (name in fields) {
  console.error(`scaffold-writeup-field: ${name} already exists`);
  process.exit(1);
}
const spec: FieldSpec = {
  type,
  ...(values.required ? { required: true } : {}),
  editable: values.editable,
  public: values.public,
  ownership: values.ownership,
  ...(values['cli-flag'] ? { cli_flag: values['cli-flag'] } : {}),
};
if (type === 'boolean') spec.default = false;
if (type === 'string[]') spec.default = [];

fields[name] = spec;
const output = `${JSON.stringify(contract, null, 2)}\n`;
if (!values.apply) {
  console.log(JSON.stringify({ field: name, spec }, null, 2));
  console.log('dry run; add --apply, then run npm run sync:contract');
  process.exit(0);
}
fs.writeFileSync(target, output);
console.log(`added ${name} to contracts/content.v1.json`);
console.log('run npm run sync:contract to regenerate every typed consumer projection');
