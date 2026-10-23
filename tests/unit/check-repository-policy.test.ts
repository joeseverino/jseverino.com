import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SUPPRESSION } from '../audits/check-repository-policy.ts';

// Built from parts, so this file never carries the directives the audit refuses.
const nocheck = `@ts-${'nocheck'}`;
const expectError = `@ts-${'expect-error'}`;

test('a type-check escape without a reason is a suppression, in any comment form', () => {
  for (const source of [`// ${nocheck}`, `/* ${expectError} */`, `/**\n * ${nocheck}\n */`, `// ${expectError}`]) {
    assert.match(source, SUPPRESSION, source);
  }
});

// A directive opens its own comment, so a comment ending on one line never reaches a name on the next.
test('an escape with a reason, or a name on the line after a comment, is not', () => {
  for (const source of [`// ${expectError} the fixture is malformed on purpose`, `const note = \`see //\n${nocheck} in a template string\`;`]) {
    assert.doesNotMatch(source, SUPPRESSION, source);
  }
});
