// Coverage between the machine inventory and the hand-written docs: every
// audit is documented, every gate label appears in the release checklist's
// expected output, and every script appears in the command reference.
//
//   npm run test:unit

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AUDITS, auditsFor } from '../audits/registry.ts';
import { siteRoot as root } from '../../src/lib/site-root.ts';
import { packageScripts } from '../../src/lib/json.ts';

const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const scripts = packageScripts();

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
        new RegExp(`^${RegExp.escape(audit.label)}\\s`, 'm').test(checklist),
        `${audit.id}: label "${audit.label}" is missing from the expected gate output in docs/Release-Checklist.md`,
      );
    }
  });

  test('every gate command is listed in docs/Development.md', () => {
    const development = read('docs/Development.md');
    const gateScripts = Object.keys(scripts).filter((name) =>
      /^(publish:|release:|deploy:|diagnose$)/.test(name),
    );
    for (const name of gateScripts) {
      assert.ok(development.includes(`npm run ${name}`), `gate command "${name}" is missing from docs/Development.md`);
    }
  });

  test('docs/Commands.md covers every script in package.json', () => {
    const commands = read('docs/Commands.md');
    for (const name of Object.keys(scripts)) {
      assert.ok(commands.includes(`npm run ${name}`), `"${name}" is missing from docs/Commands.md`);
    }
  });
});
