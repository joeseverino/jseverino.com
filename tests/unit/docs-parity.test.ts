// Parity between the machine inventory and the hand-written docs. The prose
// can't be machine-verified for accuracy, but coverage can: every audit must
// be documented, every gate label must appear in the release checklist's
// expected output, and every script must appear in the command reference —
// so a stale doc table fails the gate instead of waiting to be noticed.
//
//   npm run test:unit

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUDITS, auditsFor } from '../audits/registry.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const scripts = JSON.parse(read('package.json')).scripts as Record<string, string>;

describe('registry/docs parity', () => {
  test('every audit script is documented in tests/ARCHITECTURE.md', () => {
    const architecture = read('tests/ARCHITECTURE.md');
    for (const audit of AUDITS) {
      const script = audit.exec.args.find((arg) => arg.startsWith('tests/audits/'));
      if (!script) continue;
      const name = path.basename(script);
      assert.ok(architecture.includes(name), `${audit.id}: ${name} never appears in tests/ARCHITECTURE.md`);
    }
  });

  test('the release-checklist expected output covers every publish-gate label', () => {
    const checklist = read('docs/Release-Checklist.md');
    for (const audit of auditsFor('publish')) {
      assert.ok(
        new RegExp(`^${audit.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s`, 'm').test(checklist),
        `${audit.id}: label "${audit.label}" is missing from the expected gate output in docs/Release-Checklist.md`,
      );
    }
  });

  test('every gate command is listed in the README command reference', () => {
    const readme = read('README.md');
    const gateScripts = Object.keys(scripts).filter((name) =>
      /^(publish:|release:|deploy:|diagnose$)/.test(name),
    );
    for (const name of gateScripts) {
      assert.ok(readme.includes(`npm run ${name}`), `gate command "${name}" is missing from README.md`);
    }
  });

  test('docs/Commands.md covers every script in package.json', () => {
    const commands = read('docs/Commands.md');
    for (const name of Object.keys(scripts)) {
      assert.ok(commands.includes(`npm run ${name}`), `"${name}" is missing from docs/Commands.md`);
    }
  });
});
