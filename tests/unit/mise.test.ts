import { test } from 'node:test';
import assert from 'node:assert/strict';
import { namesTask, type MiseTask } from '../../bin/lib/mise.ts';

const task = (name: string, aliases: string[] = []): MiseTask => ({ name, aliases, description: '', hide: false });
const tasks = [task('checks', ['fast']), task('checks:types'), task('browser:e2e')];

test('a doc names a task by its name, an alias, or a glob that matches one', () => {
  for (const name of ['checks', 'fast', 'checks:types', 'checks:*', 'browser:*']) assert.ok(namesTask(name, tasks), name);
});

test('a name no task carries, or a glob that matches none, names nothing', () => {
  for (const name of ['check', 'checks:type', 'built:*', 'diagnose', 'checks.types']) assert.equal(namesTask(name, tasks), false, name);
});
