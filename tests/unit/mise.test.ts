import { test } from 'node:test';
import assert from 'node:assert/strict';
import { miseTasks, namesTask, type MiseTask } from '../../bin/lib/mise.ts';

const task = (name: string, aliases: string[] = []): MiseTask => ({ name, aliases, description: '', hide: false });
const tasks = [task('checks', ['fast']), task('checks:types'), task('browser:e2e')];

test('a doc names a task by its name, an alias, or a glob that matches one', () => {
  for (const name of ['checks', 'fast', 'checks:types', 'checks:*', 'browser:*']) assert.ok(namesTask(name, tasks), name);
});

test('a name no task carries, or a glob that matches none, names nothing', () => {
  for (const name of ['check', 'checks:type', 'built:*', 'diagnose', 'checks.types']) assert.equal(namesTask(name, tasks), false, name);
});

// `mise tasks` and the generated list in docs/Commands.md are the command reference, so a task
// without a description is a command nobody can find.
test('every visible task carries a description', () => {
  const undescribed = miseTasks().filter((task) => !task.description.trim()).map((task) => task.name);
  assert.deepEqual(undescribed, []);
});
