// Terminal primitives behind `site manage`.
import { once } from 'node:events';
import os from 'node:os';
import { type Key as Keypress, emitKeypressEvents as nodeEmitKeypressEvents } from 'node:readline';
import { stripVTControlCharacters, styleText } from 'node:util';

// What a piece of text means; tint() turns it into styling only when a frame is drawn.
export type Tone = 'plain' | 'strong' | 'muted' | 'ok' | 'warn' | 'error' | 'accent' | 'draft' | 'active' | 'grabbed';
export interface Note {
  tone: Tone;
  text: string;
}

const TONES: Record<Tone, Parameters<typeof styleText>[0]> = {
  plain: [],
  strong: 'bold',
  muted: 'dim',
  ok: 'green',
  warn: 'yellow',
  error: 'red',
  accent: 'cyan',
  draft: 'magenta',
  active: ['bold', 'inverse'],
  grabbed: 'inverse',
};

// styleText writes no styling when stdout is not a terminal or NO_COLOR is set, and FORCE_COLOR overrides both.
export const tint = (tone: Tone, text: string): string => styleText(TONES[tone], text);

const SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function graphemes(text: string): string[] {
  return [...SEGMENTER.segment(text)].map((entry) => entry.segment);
}

function cellWidth(grapheme: string | undefined): number {
  if (!grapheme || /^[\p{Cc}\p{Cf}\p{Mn}\p{Me}]+$/u.test(grapheme)) return 0;
  // An emoji draws two cells; a pictograph in text presentation (©, ™, ↔) draws one.
  if (/\p{RGI_Emoji}/v.test(grapheme)) return 2;
  const cp = grapheme.codePointAt(0) ?? 0;
  return cp >= 0x1100 &&
    (cp <= 0x115f ||
      cp === 0x2329 ||
      cp === 0x232a ||
      (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe10 && cp <= 0xfe19) ||
      (cp >= 0xfe30 && cp <= 0xfe6f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x20000 && cp <= 0x3fffd))
    ? 2
    : 1;
}

function displayWidth(text: unknown): number {
  return graphemes(stripVTControlCharacters(String(text))).reduce((width, grapheme) => width + cellWidth(grapheme), 0);
}

export function previousBoundary(text: string, index: number): number {
  let previous = 0;
  for (const entry of SEGMENTER.segment(text)) {
    if (entry.index >= index) break;
    previous = entry.index;
  }
  return previous;
}

export function nextBoundary(text: string, index: number): number {
  for (const entry of SEGMENTER.segment(text)) {
    if (entry.index > index) return entry.index;
  }
  return text.length;
}

function suffixByWidth(text: string, width: number): string {
  const parts = graphemes(text);
  const kept: string[] = [];
  let used = 0;
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const cells = cellWidth(parts[i]);
    if (used + cells > width) break;
    kept.unshift(parts[i] ?? '');
    used += cells;
  }
  return kept.join('');
}

function prefixByWidth(text: string, width: number): string {
  let out = '';
  let used = 0;
  for (const grapheme of graphemes(text)) {
    const cells = cellWidth(grapheme);
    if (used + cells > width) break;
    out += grapheme;
    used += cells;
  }
  return out;
}

// The SGR code that closes each one styleText opens.
function closerOf(code: number): number | undefined {
  if (code === 1 || code === 2) return 22;
  if (code === 3 || code === 4 || code === 7 || code === 8 || code === 9) return 20 + code;
  if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) return 39;
  if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) return 49;
  return undefined;
}

// Clips to a width in cells, passing escape sequences through. A clip that cuts a styled span off
// before its close ends with a reset, so the style cannot bleed into the next line.
function clipAnsi(text: string, width: number): string {
  if (width <= 0) return '';
  const ansi = /\x1b(?:\[([0-?]*)[ -/]*([@-~])|\][^\x07]*(?:\x07|\x1b\\))/y;
  const open = new Set<number>();
  let out = '';
  let visible = 0;
  let i = 0;
  let clipped = false;

  while (i < text.length) {
    ansi.lastIndex = i;
    const match = ansi.exec(text);
    if (match) {
      out += match[0];
      i += match[0].length;
      if (match[2] === 'm') {
        for (const code of (match[1] || '0').split(';').map(Number)) {
          const closer = closerOf(code);
          if (code === 0) open.clear();
          else if (closer) open.add(closer);
          else open.delete(code);
        }
      }
      continue;
    }

    const ansiStart = i;
    let nextAnsi = text.indexOf('\x1b', i);
    if (nextAnsi === -1) nextAnsi = text.length;
    const chunk = text.slice(ansiStart, nextAnsi);
    let consumed = 0;
    for (const grapheme of graphemes(chunk)) {
      const cells = cellWidth(grapheme);
      if (visible + cells > width) {
        clipped = true;
        break;
      }
      out += grapheme;
      visible += cells;
      consumed += grapheme.length;
    }
    i += consumed;
    if (clipped) break;
  }

  return clipped && open.size ? `${out}\x1b[0m` : out;
}

export function truncate(text: unknown, width: number): string {
  const s = String(text);
  if (width <= 0) return '';
  if (displayWidth(s) <= width) return s;
  if (width === 1) return '…';
  return `${clipAnsi(s, width - 1)}…`;
}

// The TUI hides the terminal's cursor, so the editor draws its own in inverse video even under
// NO_COLOR: without it a field shows no cursor at all.
const cursorCell = (text: string): string => styleText('inverse', text, { validateStream: false });

export function lineEditor(input: string, cursorIndex: number, width: number): string {
  const next = nextBoundary(input, cursorIndex);
  const cursorChar = input.slice(cursorIndex, next) || ' ';
  const cursorWidth = Math.max(1, cellWidth(cursorChar));
  const available = Math.max(1, width);
  if (displayWidth(input) + (cursorIndex === input.length ? 1 : 0) <= available) {
    const before = input.slice(0, cursorIndex);
    const after = input.slice(next);
    return `${before}${cursorCell(cursorChar)}${after}`;
  }

  const rightSource = input.slice(next);
  const reserveRight = rightSource ? 1 : 0;
  const beforeBudget = Math.max(0, available - cursorWidth - reserveRight - 1);
  const before = suffixByWidth(input.slice(0, cursorIndex), beforeBudget);
  const leftHidden = before.length < cursorIndex;
  const afterBudget = Math.max(0, available - cursorWidth - displayWidth(before) - (leftHidden ? 1 : 0) - reserveRight);
  const after = prefixByWidth(rightSource, afterBudget);
  const rightHidden = after.length < rightSource.length;

  return `${leftHidden ? '…' : ''}${before}${cursorCell(cursorChar)}${after}${rightHidden ? '…' : ''}`;
}

// MANAGE_TUI_COLUMNS / MANAGE_TUI_ROWS pin the frame size for tests; otherwise the terminal reports its own.
function pinnedSize(name: string): number | undefined {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return value > 0 ? value : undefined;
}
const PINNED_COLUMNS = pinnedSize('MANAGE_TUI_COLUMNS');
const PINNED_ROWS = pinnedSize('MANAGE_TUI_ROWS');

export const terminalColumns = (): number => PINNED_COLUMNS ?? (process.stdout.columns || 110);
export const terminalRows = (): number => PINNED_ROWS ?? (process.stdout.rows || 30);

// A screen in three regions: the header and footer always show, and the body scrolls to keep
// its focus line (an index into body) in view.
export interface Frame {
  head: string[];
  body: string[];
  foot: string[];
  focus: number;
}

export const frameLines = (frame: Frame): string[] => [...frame.head, ...frame.body, ...frame.foot];

// Clips every line to the width; a frame taller than the terminal windows its body around the focus.
export function fitFrame(frame: Frame, cols: number, rows: number): string[] {
  const width = Math.max(1, cols);
  const height = Math.max(1, rows);
  const clip = (lines: string[]): string[] => lines.map((line) => clipAnsi(line, width));
  const { head, body, foot } = frame;
  if (head.length + body.length + foot.length <= height) return clip(frameLines(frame));

  const budget = Math.max(1, height - head.length - foot.length);
  const focus = Math.min(Math.max(0, frame.focus), body.length - 1);
  const start = Math.max(0, Math.min(focus - Math.floor(budget / 2), body.length - budget));
  const end = Math.min(body.length, start + budget);
  const shown = body.slice(start, end);
  if (start > 0 && shown.length > 1) shown[0] = `  ${tint('muted', '↑ more')}`;
  if (end < body.length && shown.length > 1) shown[shown.length - 1] = `  ${tint('muted', '↓ more')}`;
  // A terminal shorter than the header and footer keeps the footer, which names the keys.
  return clip([...head, ...shown, ...foot]).slice(-height);
}

// Every key the TUI names: its sequences (the first is canonical, and replay scripts send it)
// and its label in the key hints. Any other key is the character it types.
export const KEYS = {
  up: { sequences: ['\x1b[A'], label: '↑' },
  down: { sequences: ['\x1b[B'], label: '↓' },
  left: { sequences: ['\x1b[D'], label: '←' },
  right: { sequences: ['\x1b[C'], label: '→' },
  'shift-up': { sequences: ['\x1b[1;2A'], label: 'Shift+↑' },
  'shift-down': { sequences: ['\x1b[1;2B'], label: 'Shift+↓' },
  home: { sequences: ['\x1b[H', '\x1b[1~'], label: 'Home' },
  end: { sequences: ['\x1b[F', '\x1b[4~'], label: 'End' },
  delete: { sequences: ['\x1b[3~'], label: 'Delete' },
  backspace: { sequences: ['\x7f', '\b'], label: 'Backspace' },
  enter: { sequences: ['\r'], label: 'enter' },
  esc: { sequences: ['\x1b'], label: 'esc' },
  space: { sequences: [' '], label: 'space' },
  tab: { sequences: ['\t'], label: 'tab' },
  'ctrl-c': { sequences: ['\x03'], label: 'Ctrl+C' },
  'ctrl-r': { sequences: ['\x12'], label: 'Ctrl+R' },
  'ctrl-u': { sequences: ['\x15'], label: 'Ctrl+U' },
  'ctrl-w': { sequences: ['\x17'], label: 'Ctrl+W' },
} as const satisfies Record<string, { sequences: readonly [string, ...string[]]; label: string }>;

export type KeyName = keyof typeof KEYS;
// A binding names a key from KEYS, or the one character a key types.
export type Key = KeyName | (string & {});

const isKeyName = (name: string): name is KeyName => Object.hasOwn(KEYS, name);
const NAME_OF = new Map<string, KeyName>(
  Object.entries(KEYS).flatMap(([name, key]) => key.sequences.map((sequence): [string, KeyName] => [sequence, name as KeyName])),
);

export const keyOf = (sequence: string): Key => NAME_OF.get(sequence) ?? sequence;
export const keyLabel = (key: Key): string => (isKeyName(key) ? KEYS[key].label : key);
export const keySequence = (name: string): string | undefined => (isKeyName(name) ? KEYS[name].sequences[0] : undefined);

export interface KeyHandlers {
  onKey(sequence: string): void;
  onPaste(text: string): void;
}

// Node reads escapeCodeTimeout from emitKeypressEvents' second argument
// (lib/internal/readline/emitKeypressEvents.js), but its types call that argument a readline
// Interface, which declares no such field; this signature states what Node reads.
const emitKeypressEvents = nodeEmitKeypressEvents as unknown as (stream: NodeJS.ReadableStream, options: { escapeCodeTimeout: number }) => void;

// How long a lone Esc waits for the rest of a sequence; Node's default is GNU readline's 500 ms.
const ESCAPE_TIMEOUT_MS = 30;

// Delivers each key as its raw sequence, and a bracketed paste as one string. Returns the detach.
export function listenForKeys(stream: NodeJS.ReadableStream, handlers: KeyHandlers): () => void {
  emitKeypressEvents(stream, { escapeCodeTimeout: ESCAPE_TIMEOUT_MS });
  let pasted: string | null = null;
  const onKeypress = (_text: string | undefined, key: Keypress): void => {
    if (key.name === 'paste-start') pasted = '';
    else if (key.name === 'paste-end') {
      const text = pasted ?? '';
      pasted = null;
      handlers.onPaste(text);
    } else if (pasted !== null) pasted += key.sequence ?? '';
    else handlers.onKey(key.sequence ?? '');
  };
  stream.on('keypress', onKeypress);
  return () => stream.off('keypress', onKeypress);
}

// The alt screen, a hidden cursor, no autowrap, and bracketed paste, each paired with what turns it off.
const SCREEN_ON = '\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[?2004h';
const SCREEN_OFF = '\x1b[?2004l\x1b[?7h\x1b[?25h\x1b[?1049l';
const TITLE_PUSH = '\x1b[22;0t';
const TITLE_POP = '\x1b[23;0t';
// Synchronized output (DEC 2026): the terminal shows the frame only once it is complete.
const SYNC_BEGIN = '\x1b[?2026h';
const SYNC_END = '\x1b[?2026l';

const QUIT_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
const quit = (signal: NodeJS.Signals): never => process.exit(128 + os.constants.signals[signal]);
const ignore = (): void => {};

interface Session {
  handlers: KeyHandlers;
  detachKeys: (() => void) | null;
  title: string;
}
let session: Session | null = null;

function attachKeys(active: Session): void {
  process.stdin.setRawMode(true);
  active.detachKeys = listenForKeys(process.stdin, active.handlers);
  process.stdin.resume();
}

function detachKeys(active: Session): void {
  active.detachKeys?.();
  active.detachKeys = null;
  process.stdin.setRawMode(false);
  process.stdin.pause();
}

function titleSequence(active: Session, title: string): string {
  if (title === active.title) return '';
  active.title = title;
  return `\x1b]0;${title}\x07`;
}

// Takes the terminal for the TUI. Every way out of the process runs restore().
export function openTerminal(handlers: KeyHandlers): void {
  if (session) return;
  session = { handlers, detachKeys: null, title: '' };
  process.on('exit', restore);
  for (const signal of QUIT_SIGNALS) process.on(signal, quit);
  process.stdout.write(TITLE_PUSH + SCREEN_ON);
  attachKeys(session);
}

// Returns the terminal to how the TUI found it. Safe to call more than once.
export function restore(): void {
  if (!session) return;
  detachKeys(session);
  session = null;
  process.stdout.write(SCREEN_OFF + TITLE_POP);
}

// The one writer: each frame repaints the whole screen in a single synchronized write.
export function paint(frame: Frame, title: string): void {
  if (!session?.detachKeys) return;
  const lines = fitFrame(frame, terminalColumns(), terminalRows());
  process.stdout.write(`${SYNC_BEGIN}${titleSequence(session, title)}\x1b[H${lines.join('\x1b[K\n')}\x1b[K\x1b[J${SYNC_END}`);
}

// Lends the terminal to a command on the normal screen in cooked mode; Ctrl+C reaches only the command.
export async function lendTerminal<T>(title: string, work: () => Promise<T>): Promise<T> {
  const active = session;
  if (!active?.detachKeys) return work();
  detachKeys(active);
  process.off('SIGINT', quit).on('SIGINT', ignore);
  process.stdout.write(titleSequence(active, title) + SCREEN_OFF);
  try {
    return await work();
  } finally {
    process.off('SIGINT', ignore).on('SIGINT', quit);
    process.stdout.write(SCREEN_ON);
    attachKeys(active);
  }
}

// Waits for any one key while the terminal is lent out.
export async function anyKey(): Promise<void> {
  process.stdin.setRawMode(true);
  const keypress = once(process.stdin, 'keypress');
  process.stdin.resume();
  try {
    await keypress;
  } finally {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
}
