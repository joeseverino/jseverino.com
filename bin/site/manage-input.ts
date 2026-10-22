// site manage's key bindings: each mode's keys, what they do, and the hint the footer shows for them.
import { keyOf, nextBoundary, previousBoundary, type Key } from './tui.ts';
import {
  FIELDS, OUTCOME, SITE_ACTIONS, TABS, current, currentField, fieldValue, hasStaged, moveCursor, moveItem,
  toggleFeatured, togglePublished, type Mode, type Model, type Tab,
} from './manage-model.ts';

export type ManageEffect =
  | { type: 'exit'; message: string | null; save: boolean }
  | { type: 'reload' | 'open' }
  | { type: 'refresh'; announce: boolean }
  | { type: 'create'; slug: string }
  | { type: 'action'; key: string };

// The keys that trigger a binding; the footer shows the first. Consecutive bindings with the same
// hint share it ("↑/↓ select"), and a binding without one stays out of the footer.
export interface Binding {
  keys: readonly Key[];
  hint?: string | ((model: Model) => string | undefined);
  run: (model: Model, today: string) => ManageEffect | void;
}

export const SAVE_KEY = 's';

const exit = (message: string | null, save = false): ManageEffect => ({ type: 'exit', message, save });
const cancel = (): ManageEffect => exit(OUTCOME.cancelled);

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

// Back to the writeup list.
const toList = (keys: readonly Key[], hint: string): Binding => ({ keys, hint, run: (model) => { model.mode = 'list'; } });

// Quitting with staged edits asks first, on the Writeups tab where they show.
const quit = (message: string): Binding => ({
  keys: ['q', 'esc', 'ctrl-c'],
  hint: 'quit',
  run: (model) => {
    if (!hasStaged(model)) return exit(message);
    model.tab = 'writeups';
    model.mode = 'confirm-quit';
  },
});

// The number keys pick a tab by position.
const tabKeys: readonly Binding[] = TABS.map(({ name }, index) => ({
  keys: [String(index + 1)],
  run: (model) => switchTab(model, name),
}));

// Shown only on a writeup row, not on the trailing "new writeup…" row.
const onWriteup = (hint: string) => (model: Model): string | undefined =>
  model.cursor < model.items.length ? hint : undefined;

const list: readonly Binding[] = [
  { keys: ['up', 'k'], hint: 'select', run: (model) => moveCursor(model, -1) },
  { keys: ['down', 'j'], hint: 'select', run: (model) => moveCursor(model, 1) },
  {
    keys: ['enter'],
    hint: (model) => (model.cursor === model.items.length ? 'create a new writeup' : 'open'),
    run: (model) => {
      if (model.cursor === model.items.length) beginNew(model);
      else { model.mode = 'detail'; model.field = 0; }
    },
  },
  { keys: ['space', 'm'], hint: onWriteup('move'), run: (model) => { if (model.cursor < model.items.length) model.mode = 'move'; } },
  { keys: ['f'], hint: onWriteup('feature/unfeature'), run: toggleFeatured },
  { keys: ['p'], hint: onWriteup('publish/unpublish'), run: togglePublished },
  { keys: ['n'], hint: onWriteup('new writeup'), run: beginNew },
  { keys: ['o'], hint: onWriteup('open in Obsidian'), run: () => ({ type: 'open' }) },
  { keys: ['right', 'tab'], hint: 'site tab', run: (model) => switchTab(model, 'site') },
  ...tabKeys,
  { keys: ['ctrl-r', 'r'], hint: 'reload', run: requestReload },
  { keys: [SAVE_KEY], hint: (model) => (hasStaged(model) ? 'save' : undefined), run: () => exit(null, true) },
  quit(OUTCOME.cancelled),
];

const move: readonly Binding[] = [
  { keys: ['up', 'k', 'shift-up'], hint: 'move', run: (model) => moveItem(model, -1) },
  { keys: ['down', 'j', 'shift-down'], hint: 'move', run: (model) => moveItem(model, 1) },
  toList(['space', 'enter', 'esc', 'm', 'q'], 'drop'),
  { keys: ['ctrl-c'], run: cancel },
];

const detail: readonly Binding[] = [
  { keys: ['up', 'k'], hint: 'field', run: (model) => { model.field = Math.max(0, model.field - 1); } },
  { keys: ['down', 'j'], hint: 'field', run: (model) => { model.field = Math.min(FIELDS.length - 1, model.field + 1); } },
  {
    keys: ['enter'],
    hint: 'edit',
    run: (model) => {
      const field = currentField(model);
      if (!field.editable) {
        model.flash = { tone: 'muted', text: `${field.label} is read-only here${field.note ? ` (${field.note})` : ''}` };
        return;
      }
      model.mode = 'edit';
      model.input = String(fieldValue(current(model), field) || '');
      model.inputCursor = model.input.length;
    },
  },
  { keys: ['p'], hint: 'publish/unpublish', run: togglePublished },
  {
    keys: ['t'],
    hint: 'touch last_reviewed',
    run: (model, today) => {
      const item = model.items[model.cursor];
      if (!item) return;
      item.edits.lastReviewed = today;
      model.flash = { tone: 'ok', text: `staged last_reviewed as today (${today})` };
    },
  },
  {
    keys: ['r'],
    hint: 'revert changes',
    run: (model) => {
      const item = model.items[model.cursor];
      if (!item) return;
      item.edits = {};
      item.published = model.origPublished.get(item.slug) ?? item.published;
      model.flash = { tone: 'warn', text: `reverted all staged changes for ${item.slug}` };
    },
  },
  { keys: ['o'], hint: 'open in Obsidian', run: () => ({ type: 'open' }) },
  { keys: ['ctrl-r'], hint: 'reload', run: requestReload },
  toList(['esc', 'q'], 'back'),
  { keys: ['ctrl-c'], run: cancel },
];

// The line editor's own keys, shared by the edit and new-writeup modes.
const lineEditing: readonly Binding[] = [
  { keys: ['left'], hint: 'move', run: (model) => { model.inputCursor = previousBoundary(model.input, model.inputCursor); } },
  { keys: ['right'], hint: 'move', run: (model) => { model.inputCursor = nextBoundary(model.input, model.inputCursor); } },
  { keys: ['home'], run: (model) => { model.inputCursor = 0; } },
  { keys: ['end'], run: (model) => { model.inputCursor = model.input.length; } },
  {
    keys: ['backspace'],
    run: (model) => {
      if (model.inputCursor === 0) return;
      const previous = previousBoundary(model.input, model.inputCursor);
      model.input = model.input.slice(0, previous) + model.input.slice(model.inputCursor);
      model.inputCursor = previous;
    },
  },
  {
    keys: ['delete'],
    run: (model) => {
      if (model.inputCursor >= model.input.length) return;
      model.input = model.input.slice(0, model.inputCursor) + model.input.slice(nextBoundary(model.input, model.inputCursor));
    },
  },
  { keys: ['ctrl-u'], hint: 'clear', run: (model) => { model.input = ''; model.inputCursor = 0; } },
  {
    keys: ['ctrl-w'],
    hint: 'delete word',
    run: (model) => {
      const start = model.input.slice(0, model.inputCursor).search(/\S+\s*$/);
      const from = start === -1 ? 0 : start;
      model.input = model.input.slice(0, from) + model.input.slice(model.inputCursor);
      model.inputCursor = from;
    },
  },
  { keys: ['ctrl-c'], run: cancel },
];

const edit: readonly Binding[] = [
  {
    keys: ['enter'],
    hint: 'stage',
    run: (model) => {
      const field = currentField(model);
      const item = current(model);
      if (model.input === String(fieldValue({ ...item, edits: {} }, field))) delete item.edits[field.key];
      else item.edits[field.key] = model.input;
      model.mode = 'detail';
    },
  },
  { keys: ['esc'], hint: 'cancel', run: (model) => { model.mode = 'detail'; } },
  ...lineEditing,
];

const newWriteup: readonly Binding[] = [
  { keys: ['enter'], hint: 'create', run: (model) => ({ type: 'create', slug: model.input.trim() }) },
  toList(['esc'], 'cancel'),
  ...lineEditing,
];

const confirmQuit: readonly Binding[] = [
  { keys: [SAVE_KEY], hint: 'save and exit', run: () => exit(null, true) },
  { keys: ['d', 'ctrl-c'], hint: 'discard and exit', run: () => exit(OUTCOME.discarded) },
  toList(['esc', 'q'], 'keep working'),
];

const confirmReload: readonly Binding[] = [
  { keys: ['y', 'r', 'ctrl-r'], hint: 'reload', run: (model) => { model.mode = 'list'; return { type: 'reload' }; } },
  toList(['esc', 'n', 'q'], 'keep working'),
  { keys: ['ctrl-c'], run: cancel },
];

const site: readonly Binding[] = [
  { keys: ['up', 'k'], hint: 'select', run: (model) => { model.actionCursor = Math.max(0, model.actionCursor - 1); } },
  { keys: ['down', 'j'], hint: 'select', run: (model) => { model.actionCursor = Math.min(SITE_ACTIONS.length - 1, model.actionCursor + 1); } },
  { keys: ['enter'], hint: 'run', run: (model) => ({ type: 'action', key: SITE_ACTIONS[model.actionCursor]?.key ?? '' }) },
  ...SITE_ACTIONS.map(({ key }): Binding => ({ keys: [key], run: () => ({ type: 'action', key }) })),
  { keys: ['left', 'tab'], hint: 'writeups tab', run: (model) => switchTab(model, 'writeups') },
  ...tabKeys,
  { keys: ['r', 'ctrl-r'], hint: 'reload status', run: () => ({ type: 'refresh', announce: true }) },
  quit(OUTCOME.exited),
];

// The Site tab has one mode; the Writeups tab's mode picks its bindings.
export const BINDINGS = {
  list, move, detail, edit, new: newWriteup, 'confirm-quit': confirmQuit, 'confirm-reload': confirmReload, site,
} satisfies Record<Mode | 'site', readonly Binding[]>;

export const activeBindings = (model: Model): readonly Binding[] =>
  BINDINGS[model.tab === 'site' ? 'site' : model.mode];

function insertText(model: Model, text: string): void {
  const clean = text.replace(/[\p{Cc}\p{Cf}]/gu, '');
  model.input = model.input.slice(0, model.inputCursor) + clean + model.input.slice(model.inputCursor);
  model.inputCursor += clean.length;
}

export function pasteManageInput(model: Model, text: string): void {
  if (model.mode !== 'edit' && model.mode !== 'new') return;
  insertText(model, text.replace(/\r\n?|\n|\t/g, ' '));
  model.flash = null;
}

export function handleManageKey(model: Model, sequence: string, today: string): ManageEffect | void {
  model.flash = null;
  const key = keyOf(sequence);
  const binding = activeBindings(model).find((candidate) => candidate.keys.includes(key));
  if (binding) return binding.run(model, today);
  // In a line editor any other key types itself; an escape sequence (Ctrl+Right, Alt+x) types nothing.
  const typing = model.tab === 'writeups' && (model.mode === 'edit' || model.mode === 'new');
  if (typing && !sequence.startsWith('\x1b')) insertText(model, sequence);
}
