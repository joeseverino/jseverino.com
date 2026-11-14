import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { load } from 'js-yaml';
import { trackedFiles } from '../../bin/lib/git.ts';
import { runSync } from '../../bin/lib/run.ts';
import { wranglerConfig } from '../../bin/lib/wrangler-config.ts';
import { siteRoot as root } from '../../src/lib/site-root.ts';
import { abort, finish, type Problem } from './lib.ts';

// Type errors get fixed. Biome refuses an explicit `any` and `@ts-ignore` (noExplicitAny,
// noTsIgnore), .astro files included, and has no rule for the other two escapes: `@ts-nocheck`,
// and `@ts-expect-error` without a reason, the one escape kept since it fails once the error is
// gone. A directive is a comment that opens with it, as TypeScript reads one.
export const SUPPRESSION = /(?:\/\/|\/\*|^[ \t]*\*)[ \t/*]*@ts-(?:nocheck\b|expect-error\b(?![ \t]+(?!\*\/)\S))/m;

// A shebang is read only when a file is run by its path, which takes the executable bit, and the
// bit is for a file that names its interpreter. Either one alone is dead.
export function executableMismatch(mode: string, head: string): { mismatch: string; fix: string } | undefined {
  const shebang = head.startsWith('#!');
  const executable = mode === '100755';
  if (shebang && !executable) return { mismatch: 'has a shebang but no executable bit', fix: 'delete the shebang, or git update-index --chmod=+x' };
  if (executable && !shebang) return { mismatch: 'has the executable bit but no shebang', fix: 'git update-index --chmod=-x' };
  return undefined;
}

function read(file: string): string {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

if (import.meta.main) {
  const failures: Problem[] = [];
  const fail = (problem: string, fix: string): void => {
    failures.push({ problem, fix });
  };

  // mise.toml is the one Node pin. Major.minor must match it; patch drift is allowed so a
  // Node security patch doesn't block every gate until the pin is bumped.
  const expectedNode = /^node = "(\d+\.\d+\.\d+)"$/m.exec(read('mise.toml'))?.[1];
  if (!expectedNode) abort('repository policy', 'mise.toml pins no exact node = "x.y.z"', 'fix: pin node in mise.toml as node = "x.y.z"');
  const actualNode = process.versions.node;
  const majorMinor = (version: string): string => version.split('.').slice(0, 2).join('.');
  if (majorMinor(actualNode) !== majorMinor(expectedNode)) {
    fail(
      `Node ${actualNode} does not match mise.toml's node ${expectedNode} (major.minor must agree)`,
      'run the gate through mise run, which puts the pinned Node on PATH',
    );
  }

  interface Manifest {
    engines?: { node?: string };
    packageManager?: string;
    scripts?: Record<string, string>;
  }

  const packageJson: Manifest = JSON.parse(read('package.json'));

  // Every command is a mise task, so npm scripts would be a second, ungated entry point.
  if (packageJson.scripts) fail('package.json declares scripts; every command is a mise task', 'move each script to a mise task, then delete scripts');

  const nodeMajor = expectedNode.split('.')[0];
  if (packageJson.engines?.node !== `>=${nodeMajor}`) {
    fail(`package.json engines.node is not ">=${nodeMajor}", the major of mise.toml's node`, `set engines.node to ">=${nodeMajor}"`);
  }
  // mise installs the npm packageManager names (idiomatic_version_file_enable_tools), so the npm
  // on PATH is that release exactly, never the one Node bundles.
  const npmPin = /^npm@(\d+\.\d+\.\d+)$/.exec(packageJson.packageManager ?? '');
  if (!npmPin) fail('package.json packageManager pins no exact npm release', 'set packageManager to npm@x.y.z');
  const npmVersion = runSync('npm', ['--version'], { cwd: root });
  if (npmPin && npmVersion !== npmPin[1]) {
    fail(`npm ${npmVersion} is on PATH; packageManager pins ${packageJson.packageManager}`, 'run mise install, which installs the npm packageManager names');
  }

  // A second copy of a native binary or of the Workers toolchain is a package two
  // dependents disagree on; docs/Dependencies.md says which pin or hold settles it.
  const lock: { packages: Record<string, unknown> } = JSON.parse(read('package-lock.json'));
  for (const name of ['esbuild', 'sharp', 'workerd', 'miniflare', 'wrangler']) {
    const copies = Object.keys(lock.packages).filter((key) => key === `node_modules/${name}` || key.endsWith(`/node_modules/${name}`));
    if (copies.length > 1) {
      fail(
        `package-lock.json installs ${copies.length} copies of ${name}: ${copies.join(', ')}`,
        `apply the pin or hold docs/Dependencies.md names for ${name}, then npm install`,
      );
    }
  }

  // The Worker's compatibility date keeps up with the runtime wrangler pins, which Renovate moves:
  // it may trail the newest date that workerd supports by at most a quarter, so new runtime
  // behavior is taken on deliberately and never left behind. A later date than workerd's is one
  // the local runtime, and so the edge suite, cannot run.
  const maxTrailDays = 90;
  const { compatibilityDate: supportedDate }: { compatibilityDate: string } = createRequire(import.meta.url)('workerd');
  const compatibilityDate = wranglerConfig().compatibility_date;
  const trailDays = (Date.parse(supportedDate) - Date.parse(compatibilityDate)) / 86_400_000;
  if (Number.isNaN(trailDays)) {
    fail(
      `wrangler.jsonc compatibility_date "${compatibilityDate}" or workerd's "${supportedDate}" is not a YYYY-MM-DD date`,
      'write compatibility_date in wrangler.jsonc as YYYY-MM-DD',
    );
  } else if (trailDays > maxTrailDays) {
    fail(
      `wrangler.jsonc compatibility_date ${compatibilityDate} trails the installed workerd's ${supportedDate} by ${trailDays} days (at most ${maxTrailDays})`,
      `move compatibility_date in wrangler.jsonc to ${supportedDate}, then run mise run browser:edge`,
    );
  } else if (trailDays < 0) {
    fail(
      `wrangler.jsonc compatibility_date ${compatibilityDate} is past the installed workerd's ${supportedDate}`,
      `move compatibility_date in wrangler.jsonc back to ${supportedDate} or earlier`,
    );
  }

  const tracked = trackedFiles(root);
  const existingTracked = tracked.filter((file) => fs.existsSync(path.join(root, file)));
  const forbiddenTracked = tracked.filter(
    (file) => /(^|\/)\.env(?:\.|$)/.test(file) || /(^|\/)\.dev\.vars(?:\.|$)/.test(file) || /(^|\/)(?:dist|\.cache)(?:\/|$)/.test(file),
  );
  if (forbiddenTracked.length > 0) {
    fail(`generated or secret files are tracked: ${forbiddenTracked.join(', ')}`, 'git rm --cached each file, and list it in .gitignore');
  }

  // One stylesheet entry plus concern-based modules; component-scoped styles would fragment the cascade.
  const componentStyles = existingTracked.filter((file) => file.startsWith('src/') && file.endsWith('.astro') && /<style(?:\s|>)/.test(read(file)));
  if (componentStyles.length > 0) {
    fail(`Astro components carry their own <style>: ${componentStyles.join(', ')}`, 'move the rules to a module under src/styles/');
  }

  // The vault's private-link markers and HQ's hostname stay out of the public snapshot.
  const publicSources = existingTracked.filter(
    (file) => file.startsWith('src/content/') || file.startsWith('src/pages/') || file.startsWith('src/components/'),
  );
  const sensitivePatterns = [
    { pattern: /title=["']private:/i, label: 'private-link title marker' },
    { pattern: /data-private-tooltip/i, label: 'private tooltip attribute' },
    { pattern: /https:\/\/hq\.jseverino\.com/i, label: 'private HQ hostname' },
  ];
  for (const file of publicSources) {
    const source = read(file);
    for (const { pattern, label } of sensitivePatterns) {
      if (pattern.test(source)) fail(`${file} exposes a ${label}`, 'remove it; a file under src/content/ changes in the vault note it syncs from');
    }
  }

  // The mode git records, which is what a checkout and CI get. Symlinks and submodules have none to check.
  for (const entry of runSync('git', ['ls-files', '--stage', '-z'], { cwd: root, raw: true }).split('\0').filter(Boolean)) {
    const [, mode = '', file = ''] = /^(\d+) \S+ \d+\t(.*)$/s.exec(entry) ?? [];
    if (!/^100(?:644|755)$/.test(mode) || !fs.existsSync(path.join(root, file))) continue;
    const head = Buffer.alloc(2);
    const fd = fs.openSync(path.join(root, file), 'r');
    fs.readSync(fd, head, 0, 2, 0);
    fs.closeSync(fd);
    const mismatch = executableMismatch(mode, head.toString('latin1'));
    if (mismatch) fail(`${file} ${mismatch.mismatch}`, mismatch.fix);
  }

  // One language: TypeScript run by Node type stripping.
  const javascript = tracked.filter((file) => /\.[cm]?jsx?$/.test(file));
  if (javascript.length > 0) {
    fail(`JavaScript files are tracked: ${javascript.join(', ')}`, 'convert each to TypeScript, which Node runs by type stripping');
  }

  // src/generated/ is written by tools (wrangler types among them) and checked against them, not by hand.
  const suppressed = existingTracked.filter(
    (file) => /\.(?:astro|[cm]?tsx?)$/.test(file) && !file.startsWith('src/generated/') && SUPPRESSION.test(read(file)),
  );
  if (suppressed.length > 0) {
    fail(`type-check suppressions without a reason: ${suppressed.join(', ')}`, 'fix the type error, or write @ts-expect-error <reason>');
  }

  // A job that enables only some tools and leaves npm out runs the npm Node bundles, not the
  // packageManager release.
  type Env = { env?: Record<string, unknown> };
  for (const file of tracked.filter((name) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(name))) {
    const { env: workflowEnv = {}, jobs = {} } = load(read(file)) as Env & { jobs?: Record<string, Env> };
    for (const [name, job] of Object.entries(jobs)) {
      const enabled = String(job.env?.MISE_ENABLE_TOOLS ?? workflowEnv.MISE_ENABLE_TOOLS ?? '').split(',');
      if (enabled.includes('node') && !enabled.includes('npm')) {
        fail(`${file} job ${name} sets MISE_ENABLE_TOOLS with node but not npm`, `add npm to the MISE_ENABLE_TOOLS of job ${name}`);
      }
    }
  }

  finish(
    failures,
    `Node ${actualNode}, ${packageJson.packageManager}; one copy of each native package; compatibility date ${compatibilityDate} within ${maxTrailDays} days of workerd's ${supportedDate}; no npm scripts; component styles in src/styles; no forbidden files; no private marker in the public sources; every shebang on an executable file; TypeScript only, no unexplained type-check suppressions; every workflow job enables npm beside node`,
    { heading: 'repository policy failed:', bullet: '- ' },
  );
}
