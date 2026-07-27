#!/usr/bin/env node
// Add one field to the canonical writeup contract. Zod, the public projection,
// MCP tool/CLI schemas, and the Tools TUI derive from this contract; this
// command never patches consumers.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'contracts/content.v1.json');
const args = process.argv.slice(2);
const value = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const boolean = (name, fallback = false) => {
  const raw = value(name);
  return raw === undefined ? fallback : raw === 'true';
};

const name = value('name');
const type = value('type', 'string');
if (!name || !/^[a-z][a-z0-9_]*$/.test(name)) {
  console.error('scaffold-writeup-field: --name is required and must be snake_case');
  process.exit(2);
}
if (!['string', 'boolean', 'date', 'integer', 'string[]'].includes(type)) {
  console.error('scaffold-writeup-field: --type must be string|boolean|date|integer|string[]');
  process.exit(2);
}

const contract = JSON.parse(fs.readFileSync(target, 'utf8'));
const fields = contract.collections.writeups.fields;
if (name in fields) {
  console.error(`scaffold-writeup-field: ${name} already exists`);
  process.exit(1);
}
const spec = {
  type,
  ...(boolean('required') ? { required: true } : {}),
  editable: boolean('editable'),
  public: boolean('public'),
  ownership: value('ownership', 'vault'),
  ...(value('cli-flag') ? { cli_flag: value('cli-flag') } : {}),
};
if (type === 'boolean') spec.default = false;
if (type === 'string[]') spec.default = [];

fields[name] = spec;
const output = `${JSON.stringify(contract, null, 2)}\n`;
if (!args.includes('--apply')) {
  console.log(JSON.stringify({ field: name, spec }, null, 2));
  console.log('dry run; add --apply, then run npm run sync:contract');
  process.exit(0);
}
fs.writeFileSync(target, output);
console.log(`added ${name} to contracts/content.v1.json`);
console.log('run npm run sync:contract to regenerate every typed consumer projection');
