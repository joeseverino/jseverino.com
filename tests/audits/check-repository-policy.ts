import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { load } from 'js-yaml';
import { trackedFiles } from '../../bin/lib/git.ts';
import { runSync } from '../../bin/lib/run.ts';
import { wranglerConfig } from '../../bin/lib/wrangler-config.ts';
import { siteRoot as root } from '../../src/lib/site-root.ts';
import { abort, finish } from './lib.ts';

// Type errors get fixed. Biome refuses an explicit `any` and `@ts-ignore` (noExplicitAny,
// noTsIgnore), .astro files included, and has no rule for the other two escapes: `@ts-nocheck`,
// and `@ts-expect-error` without a reason, the one escape kept since it fails once the error is
// gone. A directive is a comment that opens with it, as TypeScript reads one.
export const SUPPRESSION = /(?:\/\/|\/\*|^[ \t]*\*)[ \t/*]*@ts-(?:nocheck\b|expect-error\b(?![ \t]+(?!\*\/)\S))/m;

function read(file: string): string {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

if (import.meta.main) {
  const failures: string[] = [];

  // mise.toml is the one Node pin. Major.minor must match it; patch drift is allowed so a
  // Node security patch doesn't block every gate until the pin is bumped.
  const expectedNode = /^node = "(\d+\.\d+\.\d+)"$/m.exec(read('mise.toml'))?.[1];
  if (!expectedNode) abort('repository policy', 'mise.toml pins no exact node = "x.y.z"');
  const actualNode = process.versions.node;
  const majorMinor = (version: string): string => version.split('.').slice(0, 2).join('.');
  if (majorMinor(actualNode) !== majorMinor(expectedNode)) {
    failures.push(`Node ${actualNode} does not match mise.toml's node ${expectedNode} (major.minor must agree)`);
  }

  interface Manifest {
    engines?: { node?: string };
    packageManager?: string;
    scripts?: Record<string, string>;
  }

  const packageJson: Manifest = JSON.parse(read('package.json'));

  // Every command is a mise task, so npm scripts would be a second, ungated entry point.
  if (packageJson.scripts) failures.push('package.json declares scripts; every command is a mise task');

  const nodeMajor = expectedNode.split('.')[0];
  if (packageJson.engines?.node !== `>=${nodeMajor}`) {
    failures.push(`package.json engines.node must be ">=${nodeMajor}" to match mise.toml's node`);
  }
  const npmPin = /^npm@(\d+)\.\d+\.\d+$/.exec(packageJson.packageManager ?? '');
  if (!npmPin) failures.push('package.json packageManager must pin an exact npm@x.y.z');
  const npmVersion = runSync('npm', ['--version'], { cwd: root });
  if (npmPin && npmVersion.split('.')[0] !== npmPin[1]) {
    failures.push(`npm ${npmVersion} is on PATH; packageManager pins ${packageJson.packageManager}`);
  }

  // A second copy of a native binary or of the Workers toolchain is a package two
  // dependents disagree on; docs/Dependencies.md says which pin or hold settles it.
  const lock: { packages: Record<string, unknown> } = JSON.parse(read('package-lock.json'));
  for (const name of ['esbuild', 'sharp', 'workerd', 'miniflare', 'wrangler']) {
    const copies = Object.keys(lock.packages).filter((key) => key === `node_modules/${name}` || key.endsWith(`/node_modules/${name}`));
    if (copies.length > 1) failures.push(`package-lock.json installs ${copies.length} copies of ${name}: ${copies.join(', ')}`);
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
    failures.push(`wrangler.jsonc compatibility_date "${compatibilityDate}" or workerd's "${supportedDate}" is not a YYYY-MM-DD date`);
  } else if (trailDays > maxTrailDays) {
    failures.push(
      `wrangler.jsonc compatibility_date ${compatibilityDate} trails the installed workerd's ${supportedDate} by ${trailDays} days (at most ${maxTrailDays})`,
    );
  } else if (trailDays < 0) {
    failures.push(`wrangler.jsonc compatibility_date ${compatibilityDate} is past the installed workerd's ${supportedDate}`);
  }

  const tracked = trackedFiles(root);
  const existingTracked = tracked.filter((file) => fs.existsSync(path.join(root, file)));
  const forbiddenTracked = tracked.filter(
    (file) => /(^|\/)\.env(?:\.|$)/.test(file) || /(^|\/)\.dev\.vars(?:\.|$)/.test(file) || /(^|\/)(?:dist|\.cache)(?:\/|$)/.test(file),
  );
  if (forbiddenTracked.length > 0) {
    failures.push(`forbidden generated or secret files are tracked: ${forbiddenTracked.join(', ')}`);
  }

  // One stylesheet entry plus concern-based modules; component-scoped styles would fragment the cascade.
  const componentStyles = existingTracked.filter((file) => file.startsWith('src/') && file.endsWith('.astro') && /<style(?:\s|>)/.test(read(file)));
  if (componentStyles.length > 0) {
    failures.push(`Astro component styles must live in src/styles modules: ${componentStyles.join(', ')}`);
  }

  // No View Transitions, so lifecycle listeners for them are dead client code.
  const transitionHooks = existingTracked.filter(
    (file) => file.startsWith('src/') && /\.(?:astro|[cm]?[jt]sx?)$/.test(file) && read(file).includes('astro:after-swap'),
  );
  if (transitionHooks.length > 0) {
    failures.push(`Astro View Transition hooks are not used by this site: ${transitionHooks.join(', ')}`);
  }

  // Client-side HTML parsing is an injection sink and blocks an enforced Trusted Types policy;
  // scripts clone existing nodes or assign text instead.
  const clientHtmlSinks = existingTracked.filter(
    (file) => file.startsWith('src/') && /\.(?:astro|[cm]?[jt]sx?)$/.test(file) && /\.(?:innerHTML|outerHTML)\s*=|\.insertAdjacentHTML\s*\(/.test(read(file)),
  );
  if (clientHtmlSinks.length > 0) {
    failures.push(`client-side HTML assignment is forbidden: ${clientHtmlSinks.join(', ')}`);
  }

  // Deprecated private-link markers and internal service URLs must not enter the public snapshot.
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
      if (pattern.test(source)) failures.push(`${file} exposes deprecated ${label}`);
    }
  }

  // One language: TypeScript run by Node type stripping.
  const javascript = tracked.filter((file) => /\.[cm]?jsx?$/.test(file));
  if (javascript.length > 0) {
    failures.push(`JavaScript files are tracked; convert them to TypeScript: ${javascript.join(', ')}`);
  }

  // src/generated/ is written by tools (wrangler types among them) and checked against them, not by hand.
  const suppressed = existingTracked.filter(
    (file) => /\.(?:astro|[cm]?tsx?)$/.test(file) && !file.startsWith('src/generated/') && SUPPRESSION.test(read(file)),
  );
  if (suppressed.length > 0) {
    failures.push(`type-check suppressions without a reason (use @ts-expect-error <reason>): ${suppressed.join(', ')}`);
  }

  interface Job {
    'runs-on'?: string | string[];
    'timeout-minutes'?: number | string;
    uses?: string;
    strategy?: { matrix?: { os?: string[]; include?: { os?: string }[] } };
  }

  for (const file of tracked.filter((name) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(name))) {
    const { jobs = {} } = load(read(file)) as { jobs?: Record<string, Job> };
    for (const [name, job] of Object.entries(jobs)) {
      // A job calling a reusable workflow takes its runner and timeout from that workflow.
      if (job.uses) continue;
      const matrix = job.strategy?.matrix;
      const labels = [job['runs-on'] ?? [], matrix?.os ?? [], (matrix?.include ?? []).map(({ os }) => os ?? '')].flat();
      // `-latest` labels move to a new OS on GitHub's schedule, outside this repo's control.
      for (const label of labels.filter((label) => label.endsWith('-latest'))) {
        failures.push(`${file} job ${name} runs on a floating runner label: ${label}`);
      }
      if (job['timeout-minutes'] === undefined) failures.push(`${file} job ${name} has no timeout-minutes`);
    }
  }

  finish(
    failures,
    `Node ${actualNode}, ${packageJson.packageManager}; one copy of each native package; compatibility date ${compatibilityDate} within ${maxTrailDays} days of workerd's ${supportedDate}; no npm scripts; component styles in src/styles; no forbidden files; TypeScript only, no unexplained type-check suppressions; runners fixed; every job time-boxed`,
    {
      heading: 'repository policy failed:',
      bullet: '- ',
      fix: 'fix: the rule each line names: the Node and npm pins (mise.toml, engines, packageManager), a duplicated package (docs/Dependencies.md), the compatibility_date in wrangler.jsonc (move it to the date workerd supports, then run mise run browser:edge), an npm script (make it a mise task), a tracked forbidden file, a stylesheet rule, a JavaScript file or a type-check suppression, or a workflow (fixed runner, timeout-minutes)',
    },
  );
}
