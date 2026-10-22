// site manage: every writeup on one screen. Edits stage locally and save in one transactional plan through
// the writeup store. The one interactive command: it refuses to start without a terminal.
// Model in ./manage-model.ts, frames in ./manage-render.ts, dev server in ./dev-server.ts.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import {
  RESET, BOLD, DIM, GREEN, YELLOW, RED, NAMED_KEYS,
  anyKey, fitFrame, lendTerminal, openTerminal, paint, restore, terminalColumns, terminalRows,
} from './tui.ts';
import { vaultRoot, WRITEUPS_FOLDER } from '../lib/local-paths.ts';
import { siteRoot } from '../../src/lib/site-root.ts';
import { WriteupError, applyPlan, writeupStore, type WriteupPlan } from '../lib/writeups/store.ts';
import { EXIT, SiteError } from './cli.ts';
import { isoDate } from '../../src/lib/dates.ts';
import { servingDevServer, startDevServer, stopDevServer } from './dev-server.ts';
import {
  FIELDS, SITE, createWriteup, diff, load, loadSiteStatus, reload, type Model,
} from './manage-model.ts';
import { currentFrame, detailFrame, listFrame, rule, siteActionSpecs, siteFrame } from './manage-render.ts';
import { errorMessage } from '../../src/lib/error-message.ts';
import { handleManageKey, pasteManageInput, type ManageEffect } from './manage-input.ts';

// Status gathering shells out and takes ~1s, so the Site tab regathers only on r / Ctrl+R or after an action.
async function gatherSiteStatus(model: Model): Promise<string> {
  model.flash = `${DIM}gathering site status…${RESET}`;
  draw(model);
  const t0 = Date.now();
  model.siteStatus = await loadSiteStatus();
  model.flash = '';
  return ((Date.now() - t0) / 1000).toFixed(1);
}

let devBusy = false;

async function toggleDevServer(model: Model): Promise<void> {
  if (devBusy) {
    model.flash = `${YELLOW}the dev server is still starting or stopping${RESET}`;
    return;
  }
  devBusy = true;
  try {
    await switchDevServer(model);
  } finally {
    devBusy = false;
  }
}

// The lock names the server, so the toggle stops whichever Astro dev server serves this checkout.
async function switchDevServer(model: Model): Promise<void> {
  const serving = await servingDevServer(siteRoot);
  model.flash = `${YELLOW}${serving ? 'stopping' : 'starting'} dev server...${RESET}`;
  draw(model);
  if (serving) {
    await stopDevServer(siteRoot);
    const left = await servingDevServer(siteRoot);
    model.siteStatus = await loadSiteStatus();
    model.flash = left
      ? `${RED}dev server did not stop (pid ${left.pid}); run astro dev stop to see why${RESET}`
      : `${GREEN}dev server stopped${RESET}`;
    return;
  }
  await startDevServer(siteRoot);
  const started = await servingDevServer(siteRoot);
  model.siteStatus = await loadSiteStatus();
  model.flash = started
    ? `${GREEN}dev server started on ${started.url}${RESET}`
    : `${RED}dev server did not start; .astro/dev.log says why${RESET}`;
}

// Replay scripts never run real commands.
async function runCommandInline(bin: string, args: readonly string[], title: string): Promise<void> {
  if (!process.stdin.isTTY) return;
  await lendTerminal(`site manage: ${title}`, async () => {
    process.stdout.write(`\n=== ${BOLD}${title}${RESET} ===\n\n`);
    const child = spawn(bin, args, { cwd: siteRoot, stdio: 'inherit' });
    const [code, signal] = await once(child, 'close') as [number | null, NodeJS.Signals | null];
    process.stdout.write(`\n${rule(terminalColumns())}\n`);
    process.stdout.write(`Finished with exit code ${code ?? signal}. Press any key to return...`);
    await anyKey();
  });
}

// What each Site tab action key runs inline; publish reloads the writeups, the rest the site status.
const INLINE_ACTIONS: Record<string, { bin: string; args: readonly string[]; title: string; reloads?: true }> = {
  h: { bin: SITE[0], args: [SITE[1], 'status'], title: 'Repository status (site status)' },
  v: { bin: SITE[0], args: [SITE[1], 'validate'], title: 'Publish gate (site validate)' },
  g: { bin: 'mise', args: ['run', 'check'], title: 'Static gates, build, and built-site gates (mise run check)' },
  b: { bin: 'mise', args: ['run', 'build'], title: 'Astro build (mise run build)' },
  t: { bin: 'mise', args: ['run', 'browser:e2e'], title: 'Playwright suite (mise run browser:e2e)' },
  p: { bin: SITE[0], args: [SITE[1], 'publish'], title: 'Open the content PR (site publish)', reloads: true },
};

async function runAction(model: Model, key: string): Promise<void> {
  if (key === 'd') {
    void toggleDevServer(model).then(() => draw(model));
    return;
  }
  const action = INLINE_ACTIONS[key];
  if (!action) return;
  await runCommandInline(action.bin, action.args, action.title);
  if (action.reloads) await reload(model);
  else model.siteStatus = await loadSiteStatus();
}

function openInObsidian(model: Model): void {
  const item = model.items[model.cursor];
  if (!item) return;
  const vaultName = path.basename(vaultRoot());
  const uri =
    'obsidian://open?vault=' +
    encodeURIComponent(vaultName) +
    '&file=' +
    encodeURIComponent(`${WRITEUPS_FOLDER}/${item.slug}/index`);
  spawn('open', [uri], { stdio: 'ignore' }).once('error', (error) => {
    model.flash = `${RED}could not open Obsidian: ${error.message}${RESET}`;
    draw(model);
  });
  model.flash = `${DIM}opened ${item.slug} in Obsidian${RESET}`;
}

function draw(model: Model): void {
  let title = 'site manage: Writeups';
  if (model.tab === 'site') title = 'site manage: Site';
  else if (model.mode === 'detail' || model.mode === 'edit') {
    title = `site manage: ${model.items[model.cursor]?.slug || 'Writeups'}`;
  }
  paint(currentFrame(model), title);
}

// What a failed save left in the vault.
function saveFailure(error: unknown): string {
  if (!(error instanceof WriteupError)) return 'the save stopped unexpectedly; check the vault with git status before saving again';
  if (error.code !== 'transaction_failed') return 'the plan was refused before any write; nothing was written';
  return error.details.rolled_back === false
    ? 'a staged write failed and could not be fully rolled back; check the vault with git status'
    : 'a staged write failed and was rolled back; nothing was written';
}

function apply(model: Model): number {
  const { desired, featuredChanged, publishFlips, fieldEdits } = diff(model);
  if (!featuredChanged && !publishFlips.length && !fieldEdits.length) {
    process.stdout.write('no changes · nothing written\n');
    return 0;
  }

  const today = isoDate();
  const touched = new Set([...publishFlips, ...fieldEdits].map((i) => i.slug));
  const updates: ({ slug: string } & Record<string, unknown>)[] = [];
  const labels: string[] = [];
  for (const slug of touched) {
    const item = model.items.find((i) => i.slug === slug);
    if (!item) continue;
    const update: { slug: string } & Record<string, unknown> = { slug };
    const what: string[] = [];
    for (const f of FIELDS) {
      if (f.editable && f.key in item.edits) {
        update[f.label] = item.edits[f.key];
        what.push(f.label);
      }
    }
    if (item.published !== model.origPublished.get(slug)) {
      update.published = item.published;
      what.push(item.published ? 'publish' : 'unpublish');
      if (item.published && !item.publishedAt && !('publishedAt' in item.edits)) {
        update.published_at = today;
      }
    }
    updates.push(update);
    labels.push(`${slug}: ${what.join(', ')}`);
  }

  const plan: WriteupPlan = {
    updates,
    source_fingerprint: model.sourceFingerprint,
  };
  if (featuredChanged) {
    plan.featured_order = desired;
    labels.push('featured order');
  }

  try {
    applyPlan(writeupStore(), plan);
  } catch (error) {
    process.stdout.write(`  ${RED}✗${RESET} transactional save failed: ${errorMessage(error)}\n`);
    process.stdout.write(`${RED}${saveFailure(error)}${RESET}\n`);
    return 1;
  }
  for (const label of labels) {
    process.stdout.write(`  ${GREEN}✓${RESET} ${label}\n`);
  }

  const featuredDrafts = model.items.slice(0, model.divider).filter((i) => !i.published);
  for (const item of featuredDrafts) {
    process.stdout.write(`  ${YELLOW}note${RESET} ${item.slug} is featured but a draft; it holds a slot only after publishing\n`);
  }

  process.stdout.write(`${DIM}saved · run \`site publish\` to ship${RESET}\n`);
  return 0;
}

let model: Model;

let done = false;
function finish(code: number, message: string | null, runApply = false): void {
  if (done) return;
  done = true;
  restore();
  if (message) process.stdout.write(message + '\n');
  if (runApply) code = apply(model);
  if (!runApply && model.created.length) {
    process.stdout.write(`${DIM}note: scaffolded this session (already on disk): ${model.created.join(', ')}${RESET}\n`);
  }
  process.exit(code);
}

// Keys apply in order: one that starts async work (a scaffold, a reload) holds the next until it settles.
let pending: Promise<void> = Promise.resolve();
const enqueue = (work: () => void | Promise<void>): void => {
  pending = pending.then(work).catch((error: unknown) => {
    model.flash = `${RED}${errorMessage(error)}${RESET}`;
  }).then(() => draw(model));
};

function handleKey(key: string): void {
  enqueue(async () => {
    const actions = siteActionSpecs(model.siteStatus ?? {}).map((action) => action.key);
    const effect = handleManageKey(model, key, isoDate(), actions);
    if (effect) await execute(effect);
  });
}

async function execute(effect: ManageEffect): Promise<void> {
  switch (effect.type) {
    case 'exit': finish(0, effect.message, effect.save); return;
    case 'reload': await reload(model); return;
    case 'open': openInObsidian(model); return;
    case 'action': await runAction(model, effect.key); return;
    case 'refresh': {
      const seconds = await gatherSiteStatus(model);
      if (effect.announce) model.flash = `${GREEN}status refreshed${RESET}${DIM} in ${seconds}s${RESET}`;
      return;
    }
    case 'create':
      if (await createWriteup(model, effect.slug)) {
        model.mode = 'detail';
        model.field = 0;
      }
      return;
  }
}

function pasteInput(text: string): void {
  enqueue(() => pasteManageInput(model, text));
}

// MANAGE_TUI_KEYS replays a comma-separated key script without a TTY and prints the final frame;
// MANAGE_TUI_SMOKE renders one static frame. Used by tests/unit/site-manage.test.ts.
export async function manage(): Promise<never> {
  const smoke = process.env.MANAGE_TUI_SMOKE;
  const replay = process.env.MANAGE_TUI_KEYS;
  if (!replay && !smoke && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    throw new SiteError('site manage is interactive and needs a terminal', {
      code: EXIT.usage,
      fix: 'non-interactive callers use site featured, site validate, and site status (each with --json)',
    });
  }
  model = await load();

  if (smoke) {
    if (smoke === 'detail') {
      model.cursor = model.items.length - 1;
      model.mode = 'detail';
      process.stdout.write(detailFrame(model) + '\n');
    } else if (smoke === 'site') {
      model.tab = 'site';
      model.siteStatus = await loadSiteStatus();
      process.stdout.write(siteFrame(model) + '\n');
    } else {
      process.stdout.write(listFrame(model) + '\n');
    }
    process.exit(0);
  }

  if (replay) {
    // e.g. MANAGE_TUI_KEYS='down,enter' or 'p,s'. An unnamed token is typed
    // one character at a time, so 'n,my-slug,enter' types a slug into the line editor.
    for (const token of replay.split(',')) {
      const t = token.trim();
      const named = NAMED_KEYS[t];
      if (t.startsWith('paste:')) pasteInput(t.slice(6));
      else if (named) handleKey(named);
      else for (const character of t) handleKey(character);
    }
    await pending;
    process.stdout.write(fitFrame(currentFrame(model), terminalColumns(), terminalRows()).join('\n') + '\n');
    process.exit(0);
  }

  openTerminal({ onKey: handleKey, onPaste: pasteInput });
  draw(model);
  process.stdout.on('resize', () => draw(model));
  // finish() exits the process; until then the TUI owns it.
  return new Promise(() => {});
}
