#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = process.argv
  .slice(2)
  .filter((arg) => arg !== '--write')
  .map((target) => path.resolve(target));
const write = process.argv.includes('--write');

const roots = targets.length > 0 ? targets : [path.join(siteRoot, 'src/content/writeups')];

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath, files);
    if (entry.isFile() && entry.name.endsWith('.md')) files.push(fullPath);
  }
  return files;
}

function isImageLine(line) {
  return /^!\[[^\]]*\]\([^)]+\)$/.test(line.trim());
}

function startsContentBlock(line) {
  const trimmed = line.trim();
  return (
    trimmed === '' ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('![') ||
    trimmed.startsWith('::') ||
    trimmed.startsWith('```') ||
    /^[-*+]\s/.test(trimmed) ||
    /^\d+\.\s/.test(trimmed) ||
    trimmed.startsWith('|') ||
    /^<\w+/i.test(trimmed)
  );
}

function migrateFigures(markdown) {
  const lines = markdown.split(/\r?\n/);
  const output = [];
  let changed = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!isImageLine(line)) {
      output.push(line);
      continue;
    }

    let cursor = index + 1;
    const spacer = [];
    while (cursor < lines.length && lines[cursor].trim() === '') {
      spacer.push(lines[cursor]);
      cursor += 1;
    }

    if (cursor >= lines.length || startsContentBlock(lines[cursor])) {
      output.push(line, ...spacer);
      continue;
    }

    const caption = [];
    while (cursor < lines.length && lines[cursor].trim() !== '') {
      caption.push(lines[cursor]);
      cursor += 1;
    }

    output.push('::figure', line, '', ...caption, '::');
    if (cursor < lines.length) output.push(lines[cursor]);
    index = cursor;
    changed += 1;
  }

  return { changed, markdown: output.join('\n') };
}

let total = 0;
for (const root of roots) {
  for (const file of walk(root)) {
    const original = fs.readFileSync(file, 'utf8');
    const migrated = migrateFigures(original);
    if (migrated.changed === 0) continue;

    total += migrated.changed;
    console.log(`${write ? 'Migrated' : 'Would migrate'} ${migrated.changed} figure(s): ${path.relative(process.cwd(), file)}`);
    if (write) fs.writeFileSync(file, migrated.markdown);
  }
}

console.log(`${write ? 'Migrated' : 'Would migrate'} ${total} figure(s) total.`);
if (!write && total > 0) console.log('Run again with --write to update files.');
