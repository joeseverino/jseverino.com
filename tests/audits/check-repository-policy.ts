import fs from 'node:fs';
import path from 'node:path';
import { load } from 'js-yaml';
import ts from 'typescript';
import { trackedFiles } from '../../bin/lib/git.ts';
import { runSync } from '../../bin/lib/run.ts';
import { elementsNamed, parseHtml, textContent } from '../../src/lib/html.ts';
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

// Type errors get fixed: no explicit `any`, and @ts-expect-error with a reason is the
// one escape hatch (it fails once the error is gone). An .astro file's TypeScript is
// its frontmatter and its <script> elements.
const SUPPRESSION = /@ts-(?:ignore|nocheck)\b|@ts-expect-error(?!\s+\S)/;

function scripts(file: string, source: string): string[] {
  if (!file.endsWith('.astro')) return [source];
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)?.[1] ?? '';
  return [frontmatter, ...elementsNamed(parseHtml(source), 'script').map(textContent)];
}

function typeEscapes(script: string): { any: boolean; suppressed: boolean } {
  const sourceFile = ts.createSourceFile('script.ts', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const comments = new Map<number, string>();
  let any = false;
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) any = true;
    for (const range of [...ts.getLeadingCommentRanges(script, node.pos) ?? [], ...ts.getTrailingCommentRanges(script, node.end) ?? []]) {
      comments.set(range.pos, script.slice(range.pos, range.end));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  visit(sourceFile.endOfFileToken);
  return { any, suppressed: [...comments.values()].some((comment) => SUPPRESSION.test(comment)) };
}

const escapes = existingTracked
  .filter((file) => /\.(?:astro|[cm]?tsx?)$/.test(file))
  .map((file) => ({ file, found: scripts(file, read(file)).map(typeEscapes) }));
const anyTyped = escapes.filter(({ found }) => found.some(({ any }) => any)).map(({ file }) => file);
const suppressed = escapes.filter(({ found }) => found.some(({ suppressed }) => suppressed)).map(({ file }) => file);
if (suppressed.length > 0) {
  failures.push(`type-check suppressions without a reason (use @ts-expect-error <reason>): ${suppressed.join(', ')}`);
}
if (anyTyped.length > 0) failures.push(`explicit any (use unknown and narrow): ${anyTyped.join(', ')}`);

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
  `Node ${actualNode}, ${packageJson.packageManager}; component styles in src/styles; no forbidden files; TypeScript only, no explicit any or unexplained suppressions; runners fixed; every job time-boxed`,
  {
    heading: 'repository policy failed:',
    bullet: '- ',
    fix: 'fix: the rule each line names: the Node and npm pins (.nvmrc, mise.toml, engines, packageManager), a tracked forbidden file, a stylesheet rule, a JavaScript file or explicit any, or a workflow (fixed runner, timeout-minutes)',
  },
);
