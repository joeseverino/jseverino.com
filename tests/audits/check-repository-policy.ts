#!/usr/bin/env node
import { isDeepStrictEqual } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { trackedFiles } from '../../bin/lib/git.ts';
import { siteRoot as root } from '../../src/lib/site-root.ts';
import { finish } from './lib.ts';

const failures: string[] = [];

function read(file: string): string {
  return fs.readFileSync(path.join(root, file), 'utf8');
}


function fail(message: string): void {
  failures.push(message);
}

// Major.minor must match .nvmrc; patch drift is allowed so a Node security
// patch doesn't block every gate until the pin is bumped.
const expectedNode = read('.nvmrc').trim().replace(/^v/, '');
const actualNode = process.versions.node;
const majorMinor = (version: string): string => version.split('.').slice(0, 2).join('.');
if (majorMinor(actualNode) !== majorMinor(expectedNode)) {
  fail(`Node ${actualNode} does not match .nvmrc (${expectedNode}; major.minor must agree)`);
}

type DependencyField = 'dependencies' | 'devDependencies' | 'optionalDependencies';
type Manifest = { name?: string; version?: string; engines?: { node?: string }; packageManager?: string } & Partial<Record<DependencyField, Record<string, string>>>;
interface Lockfile {
  lockfileVersion?: number;
  name?: string;
  version?: string;
  packages?: Record<string, Manifest>;
}

const packageJson: Manifest = JSON.parse(read('package.json'));
const packageLock: Lockfile = JSON.parse(read('package-lock.json'));

const nodeMajor = expectedNode.split('.')[0];
if (packageJson.engines?.node !== `>=${nodeMajor}`) {
  fail(`package.json engines.node must be ">=${nodeMajor}" to match .nvmrc`);
}
const npmPin = /^npm@(\d+)\.\d+\.\d+$/.exec(packageJson.packageManager ?? '');
if (!npmPin) fail('package.json packageManager must pin an exact npm@x.y.z');
const npmAgent = /\bnpm\/(\d+)\./.exec(process.env.npm_config_user_agent ?? '');
if (npmPin && npmAgent && npmAgent[1] !== npmPin[1]) {
  fail(`npm ${npmAgent[1]}.x is running; packageManager pins ${packageJson.packageManager}`);
}
if (packageLock.lockfileVersion !== 3) fail('package-lock.json must be lockfileVersion 3');
if (packageLock.name !== packageJson.name) fail('package-lock.json name differs from package.json');
if (packageLock.version !== packageJson.version) {
  fail('package-lock.json version differs from package.json');
}
if (packageLock.packages?.['']?.version !== packageJson.version) {
  fail('package-lock.json root package version differs from package.json');
}
for (const field of ['dependencies', 'devDependencies', 'optionalDependencies'] as const satisfies readonly DependencyField[]) {
  if (!isDeepStrictEqual(packageLock.packages?.['']?.[field] ?? {}, packageJson[field] ?? {})) {
    fail(`package-lock.json root ${field} differ from package.json`);
  }
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
  fail(`forbidden generated or secret files are tracked: ${forbiddenTracked.join(', ')}`);
}

// The public stylesheet has one entry and concern-based source modules;
// component-scoped styles would fragment that audited cascade.
const componentStyles = existingTracked.filter(
  (file) => file.startsWith('src/') && file.endsWith('.astro') && /<style(?:\s|>)/.test(read(file)),
);
if (componentStyles.length > 0) {
  fail(`Astro component styles must live in src/styles modules: ${componentStyles.join(', ')}`);
}

// Literal colors are allowed only inside the generated token block. Component
// rules must name a token or derive a variant from one with color-mix().
const styleFiles = existingTracked.filter((file) => file.startsWith('src/styles/') && file.endsWith('.css'));
const authoredStyles = styleFiles
  .map((file) => {
    const stylesheet = read(file);
    // A generated block ends with a `/* <name>:end */` marker (tokens.css,
    // brand.css); strip through the last one so a hand-authored rule below it
    // is still checked, but nothing generated is mistaken for hand-authored.
    const ends = [...stylesheet.matchAll(/\/\* \w+:end \*\//g)];
    const blockEnd = ends.at(-1)?.index;
    return blockEnd !== undefined ? stylesheet.slice(blockEnd) : stylesheet;
  })
  .join('\n');
const literalColor = /#[0-9a-f]{3,8}\b|\b(?:rgb|hsl)a?\(/i;
if (literalColor.test(authoredStyles)) {
  fail('src/styles contains a literal color outside the generated token block');
}

// The site does not use View Transitions; lifecycle listeners for them would be
// dead client code.
const transitionHooks = existingTracked.filter(
  (file) => file.startsWith('src/') && /\.(?:astro|[cm]?[jt]sx?)$/.test(file) && read(file).includes('astro:after-swap'),
);
if (transitionHooks.length > 0) {
  fail(`Astro View Transition hooks are not used by this site: ${transitionHooks.join(', ')}`);
}

// Client-side HTML parsing creates an avoidable injection sink and blocks the
// site's path toward an enforced Trusted Types policy. Build-time Astro
// `set:html` remains explicit and reviewable; browser scripts clone existing
// nodes or assign text instead of reparsing strings as markup.
const clientHtmlSinks = existingTracked.filter(
  (file) => file.startsWith('src/') && /\.(?:astro|[cm]?[jt]sx?)$/.test(file) &&
    /\.(?:innerHTML|outerHTML)\s*=|\.insertAdjacentHTML\s*\(/.test(read(file)),
);
if (clientHtmlSinks.length > 0) {
  fail(`client-side HTML assignment is forbidden: ${clientHtmlSinks.join(', ')}`);
}

// Deprecated private-link markers and internal service URLs must never enter
// the public content snapshot or generated site source.
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
    if (pattern.test(source)) fail(`${file} exposes deprecated ${label}`);
  }
}

// Same-basename JS/TS module siblings (e.g. site.mjs + site.ts in one dir)
// resolve ambiguously: Vite/Astro try .mjs before .ts, the TS compiler does the
// reverse. So `astro check` and the bundler disagree and a build can break while
// the typecheck passes. Declaration files (foo.d.ts) keep a distinct stem and are
// unaffected. Forbid the collision outright.
const moduleStems = new Map<string, Set<string>>();
for (const file of tracked) {
  const match = file.match(/^(.*)\.(mjs|cjs|js|jsx|mts|cts|ts|tsx)$/);
  if (!match) continue;
  const [, stem = '', ext = ''] = match;
  const exts = moduleStems.get(stem) ?? new Set<string>();
  exts.add(ext);
  moduleStems.set(stem, exts);
}
const moduleCollisions: string[] = [];
for (const [stem, exts] of moduleStems) {
  const jsLike = ['mjs', 'cjs', 'js', 'jsx'].some((e) => exts.has(e));
  const tsLike = ['mts', 'cts', 'ts', 'tsx'].some((e) => exts.has(e));
  if (jsLike && tsLike) moduleCollisions.push(`${stem}.{${[...exts].sort().join(',')}}`);
}
if (moduleCollisions.length > 0) {
  fail(`same-basename JS/TS modules resolve ambiguously (Vite picks .mjs, tsc picks .ts): ${moduleCollisions.sort().join(', ')}`);
}

// One language: every script is TypeScript that Node runs by stripping types.
// A JavaScript file is allowed only when a tool cannot read TypeScript.
const JAVASCRIPT_ALLOWED = new Set<string>([]);
const javascript = tracked.filter((file) => /\.[cm]?jsx?$/.test(file) && !JAVASCRIPT_ALLOWED.has(file));
if (javascript.length > 0) {
  fail(`JavaScript files are tracked; convert them to TypeScript or allow-list a tool requirement: ${javascript.join(', ')}`);
}

// Type errors get fixed. @ts-expect-error with a reason is the
// one escape hatch, since it fails once the error it names is gone.
// Split so this line does not match itself.
const suppression = new RegExp(String.raw`@ts-(?:ignore|nocheck)\b|@ts-expect-` + String.raw`error(?!\s+\S)`);
const suppressed = existingTracked.filter(
  (file) => /\.(?:astro|[cm]?tsx?)$/.test(file) && suppression.test(read(file)),
);
if (suppressed.length > 0) {
  fail(`type-check suppressions without a reason (use @ts-expect-error <reason>): ${suppressed.join(', ')}`);
}

// No explicit any: unknown plus narrowing says what the code actually knows.
const explicitAny = /(?::|<|,|\|)\s*any\b(?!-)|\bas\s+any\b/;
const code = (source: string): string[] => source.split('\n').map((line) => line.replace(/(?:^|\s)\/\/.*$/, '')).filter((line) => !/^\s*\*/.test(line));
const anyTyped = existingTracked.filter((file) => /\.(?:astro|[cm]?tsx?)$/.test(file) && code(read(file)).some((line) => explicitAny.test(line)));
if (anyTyped.length > 0) fail(`explicit any (use unknown and narrow): ${anyTyped.join(', ')}`);

const automation = tracked.filter(
  (name) => name.startsWith('.github/workflows/') || /^\.github\/actions\/.+\/action\.ya?ml$/.test(name),
);
for (const file of automation) {
  const source = read(file);
  // `-latest` labels move to a new OS on GitHub's schedule, outside this repo's control.
  for (const [, label = ''] of source.matchAll(/^\s*(?:-\s*)?(?:runs-on|os):\s*(\S+)/gm)) {
    if (/-latest$/.test(label)) fail(`${file} runs on a floating runner label: ${label}`);
  }
  // Every job carries its own timeout; the default is six hours.
  const jobs = source.match(/^    runs-on:/gm)?.length ?? 0;
  const timeouts = source.match(/^    timeout-minutes:/gm)?.length ?? 0;
  if (jobs !== timeouts) fail(`${file} has ${jobs} job(s) but ${timeouts} timeout-minutes`);
  for (const [, reference = ''] of source.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+).*$/gm)) {
    if (reference.startsWith('./')) continue;
    if (/^docker:\/\/.+@sha256:[0-9a-f]{64}$/.test(reference)) continue;
    if (/^[^@\s]+@[0-9a-f]{40}$/.test(reference)) continue;
    fail(`${file} contains an unpinned action: ${reference}`);
  }
}

finish(
  failures,
  `Node ${actualNode}, ${packageJson.packageManager}; lockfile aligned; stylesheet architecture clean; no forbidden files; TypeScript only, no explicit any or unexplained suppressions; actions and runners pinned; every job time-boxed`,
  { heading: 'repository policy failed:', bullet: '- ' },
);
