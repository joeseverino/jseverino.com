// Terminal primitives behind `site manage`.
import { once } from 'node:events';
import os from 'node:os';
import { emitKeypressEvents as nodeEmitKeypressEvents, type Key } from 'node:readline';
import { stripVTControlCharacters } from 'node:util';

export const RESET = '\x1b[0m';
export const BOLD = '\x1b[1m';
export const DIM = '\x1b[2m';
export const INVERT = '\x1b[7m';
export const GREEN = '\x1b[32m';
export const YELLOW = '\x1b[33m';
export const RED = '\x1b[31m';
export const CYAN = '\x1b[36m';
export const MAGENTA = '\x1b[35m';

const SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function graphemes(text: string): string[] {
  return [...SEGMENTER.segment(text)].map((entry) => entry.segment);
}

function cellWidth(grapheme: string | undefined): number {
  if (!grapheme || /^[\p{Cc}\p{Cf}\p{Mn}\p{Me}]+$/u.test(grapheme)) return 0;
  if (/\p{Extended_Pictographic}/u.test(grapheme)) return 2;
  const cp = grapheme.codePointAt(0) ?? 0;
  return (
    cp >= 0x1100 && (
      cp <= 0x115f ||
      cp === 0x2329 || cp === 0x232a ||
      (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe10 && cp <= 0xfe19) ||
      (cp >= 0xfe30 && cp <= 0xfe6f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x20000 && cp <= 0x3fffd)
    )
  ) ? 2 : 1;
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

function clipAnsi(text: string, width: number): string {
  if (width <= 0) return '';
  const ansi = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/y;
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

  return clipped ? out + RESET : out;
}

export function truncate(text: unknown, width: number): string {
  const s = String(text);
  if (width <= 0) return '';
  if (displayWidth(s) <= width) return s;
  if (width === 1) return '…';
  return clipAnsi(s, width - 1) + '…';
}

export function lineEditor(input: string, cursorIndex: number, width: number): string {
  const next = nextBoundary(input, cursorIndex);
  const cursorChar = input.slice(cursorIndex, next) || ' ';
  const cursorWidth = Math.max(1, cellWidth(cursorChar));
  const available = Math.max(1, width);
  if (displayWidth(input) + (cursorIndex === input.length ? 1 : 0) <= available) {
    const before = input.slice(0, cursorIndex);
    const after = input.slice(next);
    return `${before}${INVERT}${cursorChar}${RESET}${after}`;
  }

  const rightSource = input.slice(next);
  const reserveRight = rightSource ? 1 : 0;
  const beforeBudget = Math.max(0, available - cursorWidth - reserveRight - 1);
  const before = suffixByWidth(input.slice(0, cursorIndex), beforeBudget);
  const leftHidden = before.length < cursorIndex;
  const afterBudget = Math.max(
    0,
    available - cursorWidth - displayWidth(before) - (leftHidden ? 1 : 0) - reserveRight,
  );
  const after = prefixByWidth(rightSource, afterBudget);
  const rightHidden = after.length < rightSource.length;

  return `${leftHidden ? '…' : ''}${before}${INVERT}${cursorChar}${RESET}${after}${rightHidden ? '…' : ''}`;
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

// Clip lines to the width; if taller than the terminal, keep header/footer and window the body around the ▸ row.
export function fitFrame(frame: string, cols: number, rows: number): string[] {
  const width = Math.max(1, cols);
  const height = Math.max(6, rows);
  const lines = frame.split('\n').map((line) => clipAnsi(line, width));
  if (lines.length <= height) return lines;

  const topCount = Math.min(6, Math.max(2, height - 4));
  const bottomCount = Math.min(3, Math.max(1, height - topCount - 1));
  const bodyBudget = height - topCount - bottomCount;
  const bodyStart = topCount;
  const bodyEnd = lines.length - bottomCount;
  const selected = lines.findIndex((line) => line.includes('▸'));
  const active = selected >= bodyStart && selected < bodyEnd ? selected : bodyStart;
  let start = Math.max(bodyStart, active - Math.floor(bodyBudget / 2));
  start = Math.min(start, Math.max(bodyStart, bodyEnd - bodyBudget));
  const end = Math.min(bodyEnd, start + bodyBudget);
  const body = lines.slice(start, end);
  if (start > bodyStart && body.length > 1) body[0] = `  ${DIM}↑ more${RESET}`;
  if (end < bodyEnd && body.length > 1) body[body.length - 1] = `  ${DIM}↓ more${RESET}`;
  return [...lines.slice(0, topCount), ...body, ...lines.slice(-bottomCount)];
}

// Named keys for replay harnesses: a comma-separated MANAGE_TUI_KEYS script
// maps through this straight to the key handler.
export const NAMED_KEYS: Readonly<Record<string, string>> = {
  up: '\x1b[A', down: '\x1b[B', left: '\x1b[D', right: '\x1b[C',
  enter: '\r', esc: '\x1b', space: ' ', tab: '\t', backspace: '\x7f',
  home: '\x1b[H', end: '\x1b[F', delete: '\x1b[3~', slash: '/',
  'ctrl-r': '\x12', 'ctrl-c': '\x03', 'ctrl-u': '\x15', 'ctrl-w': '\x17',
};

export interface KeyHandlers {
  onKey(sequence: string): void;
  onPaste(text: string): void;
}

// Node reads escapeCodeTimeout from emitKeypressEvents' second argument
// (lib/internal/readline/emitKeypressEvents.js), but its types call that argument a readline
// Interface, which declares no such field; this signature states what Node reads.
const emitKeypressEvents = nodeEmitKeypressEvents as unknown as (
  stream: NodeJS.ReadableStream,
  options: { escapeCodeTimeout: number },
) => void;

// How long a lone Esc waits for the rest of a sequence; Node's default is GNU readline's 500 ms.
const ESCAPE_TIMEOUT_MS = 30;

// Delivers each key as its raw sequence, and a bracketed paste as one string. Returns the detach.
export function listenForKeys(stream: NodeJS.ReadableStream, handlers: KeyHandlers): () => void {
  emitKeypressEvents(stream, { escapeCodeTimeout: ESCAPE_TIMEOUT_MS });
  let pasted: string | null = null;
  const onKeypress = (_text: string | undefined, key: Key): void => {
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
export function paint(frame: string, title: string): void {
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
