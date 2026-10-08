import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createEducationSource } from '../../bin/content-sync/source-adapters.ts';

const exported = {
  ok: true,
  institutions: [{
    doc_id: 'inst-1', institution: 'Example Institute', slug: 'example-institute', description: 'A test institute.',
    courses: [{ doc_id: 'c-1', code: 'CS 101', title: 'Intro', short_title: 'Intro', term: 'Fall 2024', status: 'completed', site_bullets: '- one' }],
  }],
};

let dir: string;
const write = (name: string, body: unknown, mode?: number): string => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body), mode === undefined ? undefined : { mode });
  return file;
};
const loadFrom = (file: string) => createEducationSource({ file }).load();

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'education-source-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('an export file', () => {
  test('loads, with fields the site does not read left in place', async () => {
    const dataset = await loadFrom(write('export.json', exported));
    assert.equal(dataset.institutions[0]?.courses[0]?.code, 'CS 101');
  });

  test('is read once', async () => {
    const file = write('export.json', exported);
    const source = createEducationSource({ file });
    const first = await source.load();
    fs.writeFileSync(file, 'not json');
    assert.equal(await source.load(), first);
  });

  test('is held to the published schema', async () => {
    await assert.rejects(loadFrom(write('missing.json', { ok: true })), /missing institutions/);
    const badStatus = structuredClone(exported);
    (badStatus.institutions[0]?.courses[0] as { status: string }).status = 'dropped';
    await assert.rejects(loadFrom(write('status.json', badStatus)), /\$\.institutions\[0\]\.courses\[0\]\.status: must be one of/);
  });

  test('that reports a failure says what failed', async () => {
    await assert.rejects(loadFrom(write('failed.json', { ok: false, errors: ['vault not found', 'no courses'] })), /reports:\n {2}vault not found\n {2}no courses/);
  });

  test('that is not JSON is named', async () => {
    const file = write('text.json', 'nope');
    await assert.rejects(loadFrom(file), new RegExp(`${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} is not JSON`));
  });
});

describe('the export command', () => {
  const script = (body: string): string => write('export-education', `#!/bin/sh\n${body}\n`, 0o755);

  test('is the default when no file is given, and its output is held to the same schema', async () => {
    const command = script(`cat <<'JSON'\n${JSON.stringify(exported)}\nJSON`);
    assert.equal((await createEducationSource({ command }).load()).institutions.length, 1);
    const malformed = script(`echo '{"ok":true,"institutions":[{"slug":"x"}]}'`);
    await assert.rejects(createEducationSource({ command: malformed }).load(), /missing institution/);
  });

  test('that fails with a report names the report, and one that fails silently names the exit', async () => {
    const reported = script(`echo '{"ok":false,"errors":["vault locked"]}'; exit 1`);
    await assert.rejects(createEducationSource({ command: reported }).load(), /education export failed[\s\S]*vault locked/);
    const silent = script('exit 3');
    await assert.rejects(createEducationSource({ command: silent }).load(), /education export failed/);
  });
});
