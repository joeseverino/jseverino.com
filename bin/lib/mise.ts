// The repository's mise tasks, as `mise tasks` reports them.
import path from 'node:path';
import { runSync } from './run.ts';
import { siteRoot } from '../../src/lib/site-root.ts';

export interface MiseTask {
  name: string;
  aliases: string[];
  description: string;
  hide: boolean;
}

export function miseTasks(cwd = siteRoot): MiseTask[] {
  return (JSON.parse(runSync('mise', ['tasks', 'ls', '--json'], { cwd })) as MiseTask[]).filter((task) => !task.hide);
}

// Whether `mise run <name>` names a task: a name, an alias, or a glob matching one.
export function namesTask(name: string, tasks: readonly MiseTask[]): boolean {
  return tasks.some((task) => [task.name, ...task.aliases].some((known) => path.matchesGlob(known, name)));
}
