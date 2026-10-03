// site manage: every writeup on one screen. Reorder the featured list,
// feature/unfeature, publish/unpublish, scaffold a writeup, edit frontmatter.
// Changes stage locally and are written on save in one transactional plan
// through the writeup store (bin/lib/writeups/store.ts). Gate issues come from the
// same check `site validate` runs. The one interactive command: it refuses to
// start without a terminal. The model is in ./manage-model.ts, the frames in
// ./manage-render.ts, dev-server control in ./dev-server.ts; this file reads
// keys, runs actions, and saves.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  RESET, BOLD, DIM, GREEN, YELLOW, RED,
  fitFrame, previousBoundary, nextBoundary,
  enterAlt, leaveAlt, createTitleSetter, createInputPump, NAMED_KEYS,
} from './tui.ts';
import { vaultRoot, WRITEUPS_FOLDER } from '../lib/local-paths.ts';
import { siteRoot } from '../../src/lib/site-root.ts';
import { WriteupError, applyPlan, writeupStore, type WriteupPlan } from '../lib/writeups/store.ts';
import { EXIT, SiteError } from './cli.ts';
import { isoDate } from '../../src/lib/dates.ts';
import { DEV_PORT, isListening, listeners, startDevServer, stopDevServer, type StartedServer } from './dev-server.ts';
import {
  FIELDS, SITE, createWriteup, current, currentField, diff, fieldValue, hasStaged, load, loadSiteStatus, moveCursor, moveItem,
  reload, toggleFeatured, togglePublished, type Model, type Tab,
} from './manage-model.ts';
import { currentFrame, detailFrame, drawTabBar, listFrame, siteActionSpecs, siteFrame, terminalColumns, terminalRows } from './manage-render.ts';

// MANAGE_TUI_KEYS replays a comma-separated key script through the real
// handler without a TTY and prints only the final frame; MANAGE_TUI_SMOKE
// renders one static frame. Used by tests/unit/site-manage.test.ts.
const REPLAY = !!process.env.MANAGE_TUI_KEYS;

// Status gathering shells out (git, check-security, curl) and takes ~1s, so
// the Site tab keeps the first result and only regathers on r / Ctrl+R or
// after an action; the "as of" timestamp shows how stale it is.
function gatherSiteStatus(model: Model): string {
  const cols = terminalColumns();
  if (!REPLAY) {
    process.stdout.write(
      '\x1b[2J\x1b[H\n' + drawTabBar(model) + '\n' +
      `  ${'─'.repeat(Math.max(40, cols - 4))}\n\n` +
      `  ${DIM}gathering site status…${RESET}\n`,
    );
  }
  const t0 = Date.now();
  model.siteStatus = loadSiteStatus();
  return ((Date.now() - t0) / 1000).toFixed(1);
}

function switchTab(model: Model, tab: Tab): void {
  model.tab = tab;
  model.flash = '';
  if (tab === 'site' && !model.siteStatus) gatherSiteStatus(model);
}

// Stops only the server this session started; a listener manage did not
// start is named and left alone.
let started: StartedServer | null = null;

async function toggleDevServer(model: Model): Promise<void> {
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
  let up = false;
  for (let i = 0; i < 20 && started; i++) {
    if (isListening(DEV_PORT)) {
      up = true;
      break;
    }
    await delay(100);
  }
  model.siteStatus = loadSiteStatus();
  model.flash = up
    ? `${GREEN}dev server started on http://127.0.0.1:${DEV_PORT}${RESET}`
    : `${RED}dev server failed to start (check port ${DEV_PORT} manually)${RESET}`;
}

function runCommandInline(bin: string, args: readonly string[], title: string): void {
  if (!process.stdin.isTTY) return; // replay scripts never run real commands
  setTitle(`site manage: ${title}`);
  process.stdin.setRawMode(false);
  process.stdin.pause();
  process.stdout.write('\x1b[?2004l\x1b[?7h\x1b[?25h\x1b[?1049l'); // Disable paste mode, wrap, show cursor

  process.stdout.write(`\n=== ${BOLD}${title}${RESET} ===\n\n`);

  const res = spawnSync(bin, args, { cwd: siteRoot, stdio: 'inherit' });

  process.stdout.write('\n─────────────────────────────────────────────────────────────────────────────\n');
  process.stdout.write(`Finished with exit code ${res.status}. Press any key to return...`);

  // Node keeps the TTY fd non-blocking, so fs.readSync(0, …) EAGAINs straight
  // through "press any key"; block in a child that owns the terminal instead.
  spawnSync('bash', ['-c', 'read -rsn1'], { stdio: 'inherit' });

  process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[?2004h'); // Restore TUI terminal modes
  process.stdin.setRawMode(true);
  process.stdin.resume();
}

function runStatus(model: Model): void {
  runCommandInline(SITE[0], [SITE[1], 'status'], 'Repository status (site status)');
  model.siteStatus = loadSiteStatus();
}

function runValidate(model: Model): void {
  runCommandInline(SITE[0], [SITE[1], 'validate'], 'Publish gate (site validate)');
  model.siteStatus = loadSiteStatus();
}

function runPublish(model: Model): void {
  runCommandInline(SITE[0], [SITE[1], 'publish'], 'Open the content PR (site publish)');
  reload(model);
}

function runDiagnose(model: Model): void {
  runCommandInline('npm', ['run', '-s', 'diagnose'], 'Full diagnostic gate (npm run diagnose)');
  model.siteStatus = loadSiteStatus();
}

function runBuild(model: Model): void {
  runCommandInline('npm', ['run', '-s', 'build'], 'Astro build (npm run build)');
  model.siteStatus = loadSiteStatus();
}

function runTests(model: Model): void {
  runCommandInline('npm', ['run', '-s', 'test:e2e'], 'Playwright suite (npm run test:e2e)');
  model.siteStatus = loadSiteStatus();
}

// What each Site tab action key runs.
const SITE_ACTIONS: Record<string, (model: Model) => void> = {
  d: (model) => { void toggleDevServer(model).then(() => draw(model)); },
  h: runStatus,
  v: runValidate,
  g: runDiagnose,
  b: runBuild,
  t: runTests,
  p: runPublish,
};

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
      if (f.flag && f.key in item.edits) {
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
    process.stdout.write(`  ${RED}✗${RESET} transactional save failed: ${(error as Error).message}\n`);
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

function lineInput(model: Model, key: string): void {
  if (key === '\x7f' || key === '\b') {
    if (model.inputCursor > 0) {
      const previous = previousBoundary(model.input, model.inputCursor);
      model.input =
        model.input.slice(0, previous) +
        model.input.slice(model.inputCursor);
      model.inputCursor = previous;
    }
    return;
  }
  if (key === '\x1b[3~') {
    if (model.inputCursor < model.input.length) {
      const next = nextBoundary(model.input, model.inputCursor);
      model.input =
        model.input.slice(0, model.inputCursor) +
        model.input.slice(next);
    }
    return;
  }
  if (key === '\x1b[D') {
    model.inputCursor = previousBoundary(model.input, model.inputCursor);
    return;
  }
  if (key === '\x1b[C') {
    model.inputCursor = nextBoundary(model.input, model.inputCursor);
    return;
  }
  if (key === '\x1b[H' || key === '\x1b[1~') {
    model.inputCursor = 0;
    return;
  }
  if (key === '\x1b[F' || key === '\x1b[4~') {
    model.inputCursor = model.input.length;
    return;
  }
  if (key === '\x15') { // Ctrl+U: clear input
    model.input = '';
    model.inputCursor = 0;
    return;
  }
  if (key === '\x17') { // Ctrl+W: delete last word
    const before = model.input.slice(0, model.inputCursor);
    const start = before.search(/\S+\s*$/);
    const deleteFrom = start === -1 ? 0 : start;
    model.input = model.input.slice(0, deleteFrom) + model.input.slice(model.inputCursor);
    model.inputCursor = deleteFrom;
    return;
  }
  const clean = key.replace(/[\p{Cc}\p{Cf}]/gu, '');
  if (clean) {
    model.input =
      model.input.slice(0, model.inputCursor) +
      clean +
      model.input.slice(model.inputCursor);
    model.inputCursor += clean.length;
  }
}

function pasteInput(text: string): void {
  if (model.mode !== 'edit' && model.mode !== 'new') return;
  const clean = text
    .replace(/\r\n?|\n|\t/g, ' ')
    .replace(/[\p{Cc}\p{Cf}]/gu, '');
  if (!clean) return;
  model.input =
    model.input.slice(0, model.inputCursor) +
    clean +
    model.input.slice(model.inputCursor);
  model.inputCursor += clean.length;
  model.flash = '';
  draw(model);
}

function handleKey(key: string): void {
  model.flash = '';

  if (model.tab === 'site') {
    switch (key) {
      case '1': switchTab(model, 'writeups'); break;
      case '2': switchTab(model, 'site'); break;
      case '\t': case '\x1b[D': switchTab(model, 'writeups'); break;
      case 'r': case '\x12': { // r or Ctrl+R: regather status
        const secs = gatherSiteStatus(model);
        model.flash = `${GREEN}status refreshed${RESET}${DIM} in ${secs}s${RESET}`;
        break;
      }
      case '\x1b[A': case 'k':
        model.actionCursor = Math.max(0, model.actionCursor - 1);
        break;
      case '\x1b[B': case 'j':
        model.actionCursor = Math.min(siteActionSpecs(model.siteStatus || {}).length - 1, model.actionCursor + 1);
        break;
      case '\r':
        SITE_ACTIONS[siteActionSpecs(model.siteStatus || {})[model.actionCursor]?.key ?? '']?.(model);
        break;
      case 'd': case 'h': case 'v': case 'g': case 'b': case 't': case 'p':
        SITE_ACTIONS[key]?.(model);
        break;
      case 'q': case '\x1b': case '\x03':
        if (hasStaged(model)) { switchTab(model, 'writeups'); model.mode = 'confirm-quit'; break; }
        finish(0, 'exited');
        return;
      default: return;
    }
    draw(model);
    return;
  }

  switch (model.mode) {
    case 'list':
      switch (key) {
        case '\x1b[A': case 'k': moveCursor(model, -1); break;
        case '\x1b[B': case 'j': moveCursor(model, 1); break;
        case ' ': case 'm': if (model.cursor < model.items.length) model.mode = 'move'; break;
        case 'f': toggleFeatured(model); break;
        case 'p': togglePublished(model); break;
        case 'n': model.mode = 'new'; model.input = ''; model.inputCursor = 0; break;
        case 'o': openInObsidian(model); break;
        case '1': switchTab(model, 'writeups'); break;
        case '2': switchTab(model, 'site'); break;
        case '\t': case '\x1b[C': switchTab(model, 'site'); break;
        case 'r': case '\x12': // r or Ctrl+R: reload
          if (hasStaged(model)) model.mode = 'confirm-reload';
          else reload(model);
          break;
        case '\r':
          if (model.cursor === model.items.length) {
            model.mode = 'new';
            model.input = '';
            model.inputCursor = 0;
          }
          else { model.mode = 'detail'; model.field = 0; }
          break;
        case 's': finish(0, null, true); return;
        case 'q': case '\x1b': case '\x03':
          if (hasStaged(model)) model.mode = 'confirm-quit';
          else { finish(0, 'cancelled · nothing written'); return; }
          break;
        default: return;
      }
      break;

    case 'move':
      switch (key) {
        case '\x1b[A': case 'k': case '\x1b[1;2A': moveItem(model, -1); break;
        case '\x1b[B': case 'j': case '\x1b[1;2B': moveItem(model, 1); break;
        case ' ': case '\r': case '\x1b': case 'm': case 'q': model.mode = 'list'; break;
        case '\x03': finish(0, 'cancelled · nothing written'); return;
        default: return;
      }
      break;

    case 'detail':
      switch (key) {
        case '\x1b[A': case 'k': model.field = Math.max(0, model.field - 1); break;
        case '\x1b[B': case 'j': model.field = Math.min(FIELDS.length - 1, model.field + 1); break;
        case 'p': togglePublished(model); break;
        case 'o': openInObsidian(model); break;
        case '\x12': // Ctrl+R: reload
          if (hasStaged(model)) model.mode = 'confirm-reload';
          else reload(model);
          break;
        case 'r': { // r: revert writeup edits
          const item = model.items[model.cursor];
          if (item) {
            item.edits = {};
            item.published = model.origPublished.get(item.slug) ?? item.published;
            model.flash = `${YELLOW}reverted all staged changes for ${item.slug}${RESET}`;
          }
          break;
        }
        case 't': { // t: touch last_reviewed date
          const item = model.items[model.cursor];
          if (item) {
            const todayStr = isoDate();
            item.edits.lastReviewed = todayStr;
            model.flash = `${GREEN}staged last_reviewed as today (${todayStr})${RESET}`;
          }
          break;
        }
        case '\r': {
          const f = currentField(model);
          if (!f.editable) { model.flash = `${DIM}${f.label} is read-only here${f.note ? ` (${f.note})` : ''}${RESET}`; break; }
          model.mode = 'edit';
          model.input = String(fieldValue(current(model), f) || '');
          model.inputCursor = model.input.length;
          break;
        }
        case 'q': case '\x1b': model.mode = 'list'; break;
        case '\x03': finish(0, 'cancelled · nothing written'); return;
        default: return;
      }
      break;

    case 'edit':
      switch (key) {
        case '\r': {
          const f = currentField(model);
          const item = current(model);
          const original = fieldValue({ ...item, edits: {} }, f);
          if (model.input === String(original)) delete item.edits[f.key];
          else item.edits[f.key] = model.input;
          model.mode = 'detail';
          break;
        }
        case '\x1b': model.mode = 'detail'; break;
        case '\x03': finish(0, 'cancelled · nothing written'); return;
        default: lineInput(model, key); break;
      }
      break;

    case 'new':
      switch (key) {
        case '\r':
          if (createWriteup(model, model.input.trim())) {
            model.mode = 'detail';
            model.field = 0;
          }
          break;
        case '\x1b': model.mode = 'list'; break;
        case '\x03': finish(0, 'cancelled · nothing written'); return;
        default: lineInput(model, key); break;
      }
      break;

    case 'confirm-quit':
      switch (key) {
        case 's': finish(0, null, true); return;
        case 'd': finish(0, 'discarded · nothing written'); return;
        case '\x1b': case 'q': model.mode = 'list'; break;
        case '\x03': finish(0, 'discarded · nothing written'); return;
        default: return;
      }
      break;

    case 'confirm-reload':
      switch (key) {
        case 'y': case 'r': case '\x12': reload(model); model.mode = 'list'; break;
        case 'n': case '\x1b': case 'q': model.mode = 'list'; break;
        case '\x03': finish(0, 'cancelled · nothing written'); return;
        default: return;
      }
      break;
  }
  draw(model);
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
  model = load();

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
