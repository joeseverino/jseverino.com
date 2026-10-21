// site manage: every writeup on one screen. Edits stage locally and save in one transactional plan through
// the writeup store. The one interactive command: it refuses to start without a terminal.
// Model in ./manage-model.ts, frames in ./manage-render.ts, dev server in ./dev-server.ts.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  RESET, BOLD, DIM, GREEN, YELLOW, RED,
  fitFrame,
  enterAlt, leaveAlt, createTitleSetter, createInputPump, NAMED_KEYS,
} from './tui.ts';
import { vaultRoot, WRITEUPS_FOLDER } from '../lib/local-paths.ts';
import { siteRoot } from '../../src/lib/site-root.ts';
import { WriteupError, applyPlan, writeupStore, type WriteupPlan } from '../lib/writeups/store.ts';
import { EXIT, SiteError } from './cli.ts';
import { isoDate } from '../../src/lib/dates.ts';
import { DEV_PORT, isListening, listeners, running, startDevServer, stopDevServer, type StartedServer } from './dev-server.ts';
import {
  FIELDS, SITE, createWriteup, diff, load, loadSiteStatus, reload, type Model,
} from './manage-model.ts';
import { currentFrame, detailFrame, drawTabBar, listFrame, rule, siteActionSpecs, siteFrame, terminalColumns, terminalRows } from './manage-render.ts';
import { errorMessage } from '../../src/lib/error-message.ts';
import { handleManageKey, pasteManageInput, type ManageEffect } from './manage-input.ts';

// MANAGE_TUI_KEYS replays a comma-separated key script without a TTY and prints the final frame;
// MANAGE_TUI_SMOKE renders one static frame. Used by tests/unit/site-manage.test.ts.
const REPLAY = !!process.env.MANAGE_TUI_KEYS;

// Status gathering shells out and takes ~1s, so the Site tab regathers only on r / Ctrl+R or after an action.
function gatherSiteStatus(model: Model): string {
  const cols = terminalColumns();
  if (!REPLAY) {
    process.stdout.write(
      '\x1b[2J\x1b[H\n' + drawTabBar(model) + '\n' +
      `  ${rule(cols)}\n\n` +
      `  ${DIM}gathering site status…${RESET}\n`,
    );
  }
  const t0 = Date.now();
  model.siteStatus = loadSiteStatus();
  return ((Date.now() - t0) / 1000).toFixed(1);
}

// Stops only the server this session started; a listener manage did not
// start is named and left alone.
let started: StartedServer | null = null;
let devBusy = false;
const DEV_START_TIMEOUT_MS = 15_000;

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

async function switchDevServer(model: Model): Promise<void> {
  if (isListening(DEV_PORT)) {
    if (!started) {
      model.flash = `${YELLOW}port ${DEV_PORT} is served by a process this session did not start (pid ${listeners(DEV_PORT).join(', ')}); stop it there${RESET}`;
      return;
    }
    model.flash = `${YELLOW}stopping dev server...${RESET}`;
    draw(model);
    const stopped = await stopDevServer(started, { cwd: siteRoot, port: DEV_PORT });
    started = null;
    model.siteStatus = loadSiteStatus();
    model.flash = stopped ? `${GREEN}dev server stopped${RESET}` : `${RED}dev server did not stop; check port ${DEV_PORT}${RESET}`;
    return;
  }
  model.flash = `${YELLOW}starting dev server...${RESET}`;
  draw(model);
  started = startDevServer([SITE[0], SITE[1], 'dev'], { cwd: siteRoot, port: DEV_PORT });
  const deadline = Date.now() + DEV_START_TIMEOUT_MS;
  let up = false;
  while (started && Date.now() < deadline) {
    if (isListening(DEV_PORT)) {
      up = true;
      break;
    }
    if (!running(started)) {
      up = isListening(DEV_PORT);
      break;
    }
    await delay(200);
  }
  if (!up && started) {
    await stopDevServer(started, { cwd: siteRoot, port: DEV_PORT });
    started = null;
  }
  model.siteStatus = loadSiteStatus();
  model.flash = up
    ? `${GREEN}dev server started on http://127.0.0.1:${DEV_PORT}${RESET}`
    : `${RED}dev server did not start on port ${DEV_PORT}; run site dev in a terminal to see why${RESET}`;
}

// Replay scripts never run real commands.
function runCommandInline(bin: string, args: readonly string[], title: string): void {
  if (!process.stdin.isTTY) return;
  setTitle(`site manage: ${title}`);
  process.stdin.setRawMode(false);
  process.stdin.pause();
  leaveAlt({ popTitle: false });
  process.stdout.write(`\n=== ${BOLD}${title}${RESET} ===\n\n`);

  const res = spawnSync(bin, args, { cwd: siteRoot, stdio: 'inherit' });

  process.stdout.write(`\n${rule(terminalColumns())}\n`);
  process.stdout.write(`Finished with exit code ${res.status ?? res.signal}. Press any key to return...`);

  // Node keeps the TTY fd non-blocking, so fs.readSync(0, …) EAGAINs straight
  // through "press any key"; block in a child that owns the terminal instead.
  spawnSync('bash', ['-c', 'read -rsn1'], { stdio: 'inherit' });

  enterAlt({ pushTitle: false });
  process.stdin.setRawMode(true);
  process.stdin.resume();
}

// What each Site tab action key runs inline; publish reloads the writeups, the rest the site status.
const INLINE_ACTIONS: Record<string, { bin: string; args: readonly string[]; title: string; reloads?: true }> = {
  h: { bin: SITE[0], args: [SITE[1], 'status'], title: 'Repository status (site status)' },
  v: { bin: SITE[0], args: [SITE[1], 'validate'], title: 'Publish gate (site validate)' },
  g: { bin: 'mise', args: ['run', 'check'], title: 'Static gates, build, and built-site gates (mise run check)' },
  b: { bin: 'npm', args: ['run', '-s', 'build'], title: 'Astro build (npm run build)' },
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
  runCommandInline(action.bin, action.args, action.title);
  if (action.reloads) await reload(model);
  else model.siteStatus = loadSiteStatus();
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
  spawnSync('open', [uri]);
  model.flash = `${DIM}opened ${item.slug} in Obsidian${RESET}`;
}

function draw(model: Model): void {
  if (REPLAY) return;
  let title = 'site manage: Writeups';
  if (model.tab === 'site') title = 'site manage: Site';
  else if (model.mode === 'detail' || model.mode === 'edit') {
    title = `site manage: ${model.items[model.cursor]?.slug || 'Writeups'}`;
  }
  setTitle(title);
  process.stdout.write('\x1b[H\x1b[2J' + fitFrame(currentFrame(model), terminalColumns(), terminalRows()));
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
let setTitle: (title: string) => void = () => {};

let done = false;
function finish(code: number, message: string | null, runApply = false): void {
  if (done) return;
  done = true;
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    leaveAlt();
  }
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
      const seconds = gatherSiteStatus(model);
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

const { feedInput, flushInput } = createInputPump({ onKey: handleKey, onPaste: pasteInput });

export async function manage(): Promise<never> {
  const smoke = process.env.MANAGE_TUI_SMOKE;
  if (!REPLAY && !smoke && (!process.stdin.isTTY || !process.stdout.isTTY)) {
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
      model.siteStatus = loadSiteStatus();
      process.stdout.write(siteFrame(model) + '\n');
    } else {
      process.stdout.write(listFrame(model) + '\n');
    }
    process.exit(0);
  }

  if (REPLAY) {
    // e.g. MANAGE_TUI_KEYS='down,enter' or 'p,s'. Unknown tokens are fed
    // literally, so 'n,my-slug,enter' types a slug into the line editor.
    for (const token of (process.env.MANAGE_TUI_KEYS ?? '').split(',')) {
      const t = token.trim();
      if (t.startsWith('paste:')) feedInput(`\x1b[200~${t.slice(6)}\x1b[201~`);
      else if (t) feedInput(NAMED_KEYS[t] ?? t);
    }
    flushInput();
    await pending;
    process.stdout.write(fitFrame(currentFrame(model), terminalColumns(), terminalRows()) + '\n');
    process.exit(0);
  }

  setTitle = createTitleSetter();
  enterAlt();
  draw(model);
  process.stdout.on('resize', () => draw(model));
  process.on('SIGINT', () => finish(0, 'cancelled · nothing written'));
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', (buf: Buffer) => feedInput(buf.toString('utf8')));
  // finish() exits the process; until then the TUI owns it.
  return new Promise(() => {});
}
