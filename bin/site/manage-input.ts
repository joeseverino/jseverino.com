import { DIM, GREEN, RESET, YELLOW, previousBoundary, nextBoundary } from './tui.ts';
import {
  FIELDS, current, currentField, fieldValue, hasStaged, moveCursor, moveItem,
  toggleFeatured, togglePublished, type Model, type Tab,
} from './manage-model.ts';

export type ManageEffect =
  | { type: 'exit'; message: string | null; save: boolean }
  | { type: 'reload' | 'open' }
  | { type: 'refresh'; announce: boolean }
  | { type: 'create'; slug: string }
  | { type: 'action'; key: string };

type KeyHandler = (model: Model, key: string, today: string) => ManageEffect | void;

const exit = (message: string | null, save = false): ManageEffect => ({ type: 'exit', message, save });

function switchTab(model: Model, tab: Tab): ManageEffect | void {
  model.tab = tab;
  if (tab === 'site' && !model.siteStatus) return { type: 'refresh', announce: false };
}

function requestReload(model: Model): ManageEffect | void {
  if (hasStaged(model)) model.mode = 'confirm-reload';
  else return { type: 'reload' };
}

function beginNew(model: Model): void {
  model.mode = 'new';
  model.input = '';
  model.inputCursor = 0;
}

function siteKey(model: Model, key: string, actions: readonly string[]): ManageEffect | void {
  switch (key) {
    case '1': return switchTab(model, 'writeups');
    case '2': return switchTab(model, 'site');
    case '\t': case '\x1b[D': return switchTab(model, 'writeups');
    case 'r': case '\x12': return { type: 'refresh', announce: true };
    case '\x1b[A': case 'k':
      model.actionCursor = Math.max(0, model.actionCursor - 1);
      break;
    case '\x1b[B': case 'j':
      model.actionCursor = Math.min(actions.length - 1, model.actionCursor + 1);
      break;
    case '\r':
      return { type: 'action', key: actions[model.actionCursor] ?? '' };
    case 'q': case '\x1b': case '\x03':
      if (hasStaged(model)) { switchTab(model, 'writeups'); model.mode = 'confirm-quit'; break; }
      return exit('exited');
    default:
      if (actions.includes(key)) return { type: 'action', key };
  }
}

function listKey(model: Model, key: string): ManageEffect | void {
  switch (key) {
    case '\x1b[A': case 'k': moveCursor(model, -1); break;
    case '\x1b[B': case 'j': moveCursor(model, 1); break;
    case ' ': case 'm': if (model.cursor < model.items.length) model.mode = 'move'; break;
    case 'f': toggleFeatured(model); break;
    case 'p': togglePublished(model); break;
    case 'n': beginNew(model); break;
    case 'o': return { type: 'open' };
    case '1': return switchTab(model, 'writeups');
    case '2': return switchTab(model, 'site');
    case '\t': case '\x1b[C': return switchTab(model, 'site');
    case 'r': case '\x12':
      return requestReload(model);
    case '\r':
      if (model.cursor === model.items.length) beginNew(model);
      else { model.mode = 'detail'; model.field = 0; }
      break;
    case 's': return exit(null, true);
    case 'q': case '\x1b': case '\x03':
      if (hasStaged(model)) model.mode = 'confirm-quit';
      else return exit('cancelled · nothing written');
      break;
    default: return;
  }
}

function moveKey(model: Model, key: string): ManageEffect | void {
  switch (key) {
    case '\x1b[A': case 'k': case '\x1b[1;2A': moveItem(model, -1); break;
    case '\x1b[B': case 'j': case '\x1b[1;2B': moveItem(model, 1); break;
    case ' ': case '\r': case '\x1b': case 'm': case 'q': model.mode = 'list'; break;
    case '\x03': return exit('cancelled · nothing written');
    default: return;
  }
}

function detailKey(model: Model, key: string, today: string): ManageEffect | void {
  switch (key) {
    case '\x1b[A': case 'k': model.field = Math.max(0, model.field - 1); break;
    case '\x1b[B': case 'j': model.field = Math.min(FIELDS.length - 1, model.field + 1); break;
    case 'p': togglePublished(model); break;
    case 'o': return { type: 'open' };
    case '\x12':
      return requestReload(model);
    case 'r': {
      const item = model.items[model.cursor];
      if (item) {
        item.edits = {};
        item.published = model.origPublished.get(item.slug) ?? item.published;
        model.flash = `${YELLOW}reverted all staged changes for ${item.slug}${RESET}`;
      }
      break;
    }
    case 't': {
      const item = model.items[model.cursor];
      if (item) {
        item.edits.lastReviewed = today;
        model.flash = `${GREEN}staged last_reviewed as today (${today})${RESET}`;
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
    case '\x03': return exit('cancelled · nothing written');
    default: return;
  }
}

function editKey(model: Model, key: string): ManageEffect | void {
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
    case '\x03': return exit('cancelled · nothing written');
    default: lineInput(model, key); break;
  }
}

function newKey(model: Model, key: string): ManageEffect | void {
  switch (key) {
    case '\r':
      return { type: 'create', slug: model.input.trim() };
    case '\x1b': model.mode = 'list'; break;
    case '\x03': return exit('cancelled · nothing written');
    default: lineInput(model, key); break;
  }
}

function confirmQuitKey(model: Model, key: string): ManageEffect | void {
  switch (key) {
    case 's': return exit(null, true);
    case 'd': return exit('discarded · nothing written');
    case '\x1b': case 'q': model.mode = 'list'; break;
    case '\x03': return exit('discarded · nothing written');
    default: return;
  }
}

function confirmReloadKey(model: Model, key: string): ManageEffect | void {
  switch (key) {
    case 'y': case 'r': case '\x12': model.mode = 'list'; return { type: 'reload' };
    case 'n': case '\x1b': case 'q': model.mode = 'list'; break;
    case '\x03': return exit('cancelled · nothing written');
    default: return;
  }
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
  insertText(model, key);
}

function insertText(model: Model, text: string): void {
  const clean = text.replace(/[\p{Cc}\p{Cf}]/gu, '');
  model.input = model.input.slice(0, model.inputCursor) + clean + model.input.slice(model.inputCursor);
  model.inputCursor += clean.length;
}

export function pasteManageInput(model: Model, text: string): void {
  if (model.mode !== 'edit' && model.mode !== 'new') return;
  insertText(model, text.replace(/\r\n?|\n|\t/g, ' '));
  model.flash = '';
}

const handlers = {
  list: listKey,
  move: moveKey,
  detail: detailKey,
  edit: editKey,
  new: newKey,
  'confirm-quit': confirmQuitKey,
  'confirm-reload': confirmReloadKey,
} satisfies Record<Model['mode'], KeyHandler>;

export function handleManageKey(model: Model, key: string, today: string, actions: readonly string[]): ManageEffect | void {
  model.flash = '';
  return model.tab === 'site'
    ? siteKey(model, key, actions)
    : handlers[model.mode](model, key, today);
}
