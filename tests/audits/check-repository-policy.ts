#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { trackedFiles } from '../../bin/lib/git.ts';
import { runSync } from '../../bin/lib/run.ts';
import { siteRoot as root } from '../../src/lib/site-root.ts';
import { finish } from './lib.ts';

const failures: string[] = [];

function read(file: string): string {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

// Major.minor must match .nvmrc; patch drift is allowed so a Node security
// patch doesn't block every gate until the pin is bumped.
const expectedNode = read('.nvmrc').trim().replace(/^v/, '');
const actualNode = process.versions.node;
const majorMinor = (version: string): string => version.split('.').slice(0, 2).join('.');
if (majorMinor(actualNode) !== majorMinor(expectedNode)) {
  failures.push(`Node ${actualNode} does not match .nvmrc (${expectedNode}; major.minor must agree)`);
}
// Cloudflare Pages reads .nvmrc and every other run takes mise's node, so the two pins are one version.
const miseNode = /^node = "([^"]+)"$/m.exec(read('mise.toml'))?.[1];
if (miseNode !== expectedNode) {
  failures.push(`mise.toml pins node ${miseNode ?? '(none)'} but .nvmrc pins ${expectedNode}`);
}

interface Manifest {
  engines?: { node?: string };
  packageManager?: string;
}

const packageJson: Manifest = JSON.parse(read('package.json'));

const nodeMajor = expectedNode.split('.')[0];
if (packageJson.engines?.node !== `>=${nodeMajor}`) {
  failures.push(`package.json engines.node must be ">=${nodeMajor}" to match .nvmrc`);
}
const npmPin = /^npm@(\d+)\.\d+\.\d+$/.exec(packageJson.packageManager ?? '');
if (!npmPin) failures.push('package.json packageManager must pin an exact npm@x.y.z');
const npmVersion = runSync('npm', ['--version'], { cwd: root });
if (npmPin && npmVersion.split('.')[0] !== npmPin[1]) {
  failures.push(`npm ${npmVersion} is on PATH; packageManager pins ${packageJson.packageManager}`);
}

const tracked = trackedFiles(root);
const existingTracked = tracked.filter((file) => fs.existsSync(path.join(root, file)));
const forbiddenTracked = tracked.filter(
  (file) =>
    (/(^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith('.env.example')) ||
    /(^|\/)\.dev\.vars(?:\.|$)/.test(file) ||
    /(^|\/)(?:dist|playwright-report|test-results)(?:\/|$)/.test(file),
);
if (forbiddenTracked.length > 0) {
  failures.push(`forbidden generated or secret files are tracked: ${forbiddenTracked.join(', ')}`);
}

// One stylesheet entry plus concern-based modules; component-scoped styles would fragment the cascade.
const componentStyles = existingTracked.filter(
  (file) => file.startsWith('src/') && file.endsWith('.astro') && /<style(?:\s|>)/.test(read(file)),
);
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
  (file) => file.startsWith('src/') && /\.(?:astro|[cm]?[jt]sx?)$/.test(file) &&
    /\.(?:innerHTML|outerHTML)\s*=|\.insertAdjacentHTML\s*\(/.test(read(file)),
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

// Type errors get fixed. @ts-expect-error with a reason is the one escape hatch (it fails once the error is gone).
// Split so this line does not match itself.
const suppression = new RegExp(String.raw`@ts-(?:ignore|nocheck)\b|@ts-expect-` + String.raw`error(?!\s+\S)`);
const suppressed = existingTracked.filter(
  (file) => /\.(?:astro|[cm]?tsx?)$/.test(file) && suppression.test(read(file)),
);
if (suppressed.length > 0) {
  failures.push(`type-check suppressions without a reason (use @ts-expect-error <reason>): ${suppressed.join(', ')}`);
}

const explicitAny = /(?::|<|,|\|)\s*any\b(?!-)|\bas\s+any\b/;
const code = (source: string): string[] => source.split('\n').map((line) => line.replace(/(?:^|\s)\/\/.*$/, '')).filter((line) => !/^\s*\*/.test(line));
const anyTyped = existingTracked.filter((file) => /\.(?:astro|[cm]?tsx?)$/.test(file) && code(read(file)).some((line) => explicitAny.test(line)));
if (anyTyped.length > 0) failures.push(`explicit any (use unknown and narrow): ${anyTyped.join(', ')}`);

const automation = tracked.filter(
  (name) => name.startsWith('.github/workflows/') || /^\.github\/actions\/.+\/action\.ya?ml$/.test(name),
);
for (const file of automation) {
  const source = read(file);
  // `-latest` labels move to a new OS on GitHub's schedule, outside this repo's control.
  for (const [, label = ''] of source.matchAll(/^\s*(?:-\s*)?(?:runs-on|os):\s*(\S+)/gm)) {
    if (/-latest$/.test(label)) failures.push(`${file} runs on a floating runner label: ${label}`);
  }
  const jobs = source.match(/^    runs-on:/gm)?.length ?? 0;
  const timeouts = source.match(/^    timeout-minutes:/gm)?.length ?? 0;
  if (jobs !== timeouts) failures.push(`${file} has ${jobs} job(s) but ${timeouts} timeout-minutes`);
}

finish(
  failures,
  `Node ${actualNode}, ${packageJson.packageManager}; component styles in src/styles; no forbidden files; TypeScript only, no explicit any or unexplained suppressions; runners fixed; every job time-boxed`,
  {
    heading: 'repository policy failed:',
    bullet: '- ',
    fix: 'fix: the rule each line names: the Node and npm pins (.nvmrc, mise.toml, engines, packageManager), a tracked forbidden file, a stylesheet rule, a JavaScript file or explicit any, or a workflow (fixed runner, timeout-minutes)',
  },
);
