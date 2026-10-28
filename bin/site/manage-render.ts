// site manage's frames: pure functions of the model. Tones become styling here and nowhere else.

import { SITE_ORIGIN, writeupUrl } from '../../src/lib/site-config.ts';
import { SLUG_RULE } from './cli.ts';
import { activeBindings, type Binding, SAVE_KEY } from './manage-input.ts';
import { current, diff, FIELDS, fieldValue, type Item, type Model, SITE_ACTIONS, type SiteAction, type SiteStatus, TABS } from './manage-model.ts';
import { type Frame, keyLabel, lineEditor, type Tone, terminalColumns, tint, truncate } from './tui.ts';

// Every mark a frame draws, with the tone it draws in unless a row says otherwise.
const GLYPH = {
  filled: { char: '●', tone: 'ok' },
  hollow: { char: '◌', tone: 'draft' },
  raised: { char: '▲', tone: 'ok' },
  lowered: { char: '▼', tone: 'warn' },
  issue: { char: '!', tone: 'error' },
  edited: { char: '*', tone: 'warn' },
  pointer: { char: '▸', tone: 'accent' },
} as const satisfies Record<string, { char: string; tone: Tone }>;

type Glyph = (typeof GLYPH)[keyof typeof GLYPH];
const mark = (glyph: Glyph, tone: Tone = glyph.tone): string => tint(tone, glyph.char);

// A writeup's publish state: saved as published or draft, or staged to flip.
const PUBLISH_STATE = {
  published: { glyph: GLYPH.filled, tag: '', words: 'published' },
  draft: { glyph: GLYPH.hollow, tag: '[draft]', words: 'draft' },
  publishing: { glyph: GLYPH.raised, tag: '[will publish]', words: 'published' },
  unpublishing: { glyph: GLYPH.lowered, tag: '[will unpublish]', words: 'draft' },
} as const;

function publishState(model: Model, item: Item) {
  const flipped = item.published !== model.origPublished.get(item.slug);
  if (item.published) return flipped ? PUBLISH_STATE.publishing : PUBLISH_STATE.published;
  return flipped ? PUBLISH_STATE.unpublishing : PUBLISH_STATE.draft;
}

// The horizontal rule under a frame's header and between its sections.
export const rule = (cols: number): string => '─'.repeat(Math.max(40, cols - 4));

function drawTabBar(model: Model): string {
  const tabs = TABS.map(({ name, label }) => {
    const text = `  ${label}${name === 'writeups' ? ` (${model.items.length})` : ''}  `;
    return tint(name === model.tab ? 'active' : 'muted', text);
  });
  return `  ${tabs.join('  ')}`;
}

// Every frame opens with a blank line, the tab bar, a rule, and its title.
const frameHead = (model: Model, cols: number, title: string): string[] => ['', drawTabBar(model), `  ${rule(cols)}`, title, ''];

// The key hints for the active bindings, wrapped to the width.
function keyHints(model: Model, bindings: readonly Binding[] = activeBindings(model)): string[] {
  const groups: { keys: string[]; hint: string }[] = [];
  for (const binding of bindings) {
    const hint = typeof binding.hint === 'function' ? binding.hint(model) : binding.hint;
    const [key] = binding.keys;
    if (!hint || key === undefined) continue;
    const last = groups.at(-1);
    if (last?.hint === hint) last.keys.push(keyLabel(key));
    else groups.push({ keys: [keyLabel(key)], hint });
  }
  return groups.map(({ keys, hint }) => `${keys.join('/')} ${hint}`);
}

// Lines of hints joined by " · ", each within the width.
function wrapHints(lead: string, hints: readonly string[], cols: number, tone: Tone = 'muted'): string[] {
  const width = Math.max(20, cols - 4);
  const lines: string[] = [];
  let line = lead;
  for (const hint of hints) {
    const next = !line ? hint : line === lead ? `${line} ${hint}` : `${line} · ${hint}`;
    if (line && next.length > width) {
      lines.push(line);
      line = hint;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.map((text) => `  ${tint(tone, text)}`);
}

// The footer: the flash, when there is one, then a rule and the key hints.
function frameFoot(model: Model, cols: number, above: string[], hints: string[]): string[] {
  const flash = model.flash ? [`  ${tint(model.flash.tone, model.flash.text)}`, ''] : [];
  return ['', ...flash, ...above, `  ${tint('muted', rule(cols))}`, ...hints];
}

// The divider between the featured list and the writeups that are not featured.
const notFeaturedDivider = (cols: number): string => `  ${tint('muted', `──── not featured ${'─'.repeat(Math.max(4, cols - 22))}`)}`;

const legend = (): string =>
  [
    `${mark(GLYPH.filled)}${tint('muted', ` ${PUBLISH_STATE.published.words}`)}`,
    `${mark(GLYPH.hollow)}${tint('muted', ` ${PUBLISH_STATE.draft.words}`)}`,
    `${mark(GLYPH.issue)}${tint('muted', ' gate issues')}`,
    tint('muted', 'edits stay staged until you save'),
  ].join(tint('muted', ' · '));

function listFooter(model: Model, cols: number): string[] {
  if (model.mode === 'move') {
    const slug = model.items[model.cursor]?.slug ?? '';
    return wrapHints(`moving ${slug}:`, [...keyHints(model), 'crossing the line features/unfeatures'], cols);
  }
  if (model.mode === 'new') {
    return [
      `  ${tint('strong', 'new writeup slug:')} ${lineEditor(model.input, model.inputCursor, Math.max(8, cols - 24))}`,
      ...wrapHints(`${SLUG_RULE} → becomes ${writeupUrl('<slug>')}`, keyHints(model), cols),
    ];
  }
  if (model.mode === 'confirm-quit') return wrapHints('unsaved changes:', keyHints(model), cols, 'warn');
  if (model.mode === 'confirm-reload') return wrapHints('unsaved changes will be lost:', keyHints(model), cols, 'warn');
  return wrapHints('', keyHints(model), cols);
}

export function listFrame(model: Model): Frame {
  const cols = terminalColumns();
  const slugWidth = Math.max(...model.items.map((i) => i.slug.length), 10) + 2;
  const head = frameHead(model, cols, `  ${tint('strong', 'site manage')}${tint('muted', ':')} ${legend()}`);
  head.push(`  ${tint('strong', 'FEATURED')}  ${tint('muted', 'home page renders this order')}`);

  const body: string[] = [];
  let focus = 0;
  model.items.forEach((item, idx) => {
    if (idx === model.divider) body.push(notFeaturedDivider(cols));
    const selected = idx === model.cursor;
    if (selected) focus = body.length;
    const state = publishState(model, item);
    const pointer = selected ? mark(GLYPH.pointer) : ' ';
    const slot = idx < model.divider ? tint('accent', String(idx + 1).padStart(2)) : tint('muted', ' ·');
    const tag = state.tag ? `${state.tag}  ` : '';
    const gateMark = model.issues.get(item.slug)?.length ? mark(GLYPH.issue) : ' ';
    const edited = Object.keys(item.edits).length ? mark(GLYPH.edited) : ' ';
    const slugTone: Tone = selected ? (model.mode === 'move' ? 'grabbed' : 'strong') : 'plain';
    const title = tint('muted', truncate(item.title, cols - slugWidth - tag.length - 15));
    body.push(
      `  ${pointer} ${slot} ${mark(state.glyph)} ${gateMark}${edited}${tint(slugTone, item.slug.padEnd(slugWidth))}${tint(state.glyph.tone, tag)}${title}`,
    );
  });
  if (model.divider === model.items.length) body.push(notFeaturedDivider(cols));
  const onNew = model.cursor === model.items.length;
  if (onNew) focus = body.length;
  body.push(`  ${onNew ? mark(GLYPH.pointer) : ' '} ${tint('muted', ' +')}     ${tint(onNew ? 'strong' : 'muted', 'new writeup…')}`);

  const { featuredChanged, publishFlips, fieldEdits } = diff(model);
  const staged: string[] = [];
  if (featuredChanged) staged.push('featured order');
  if (publishFlips.length) staged.push(`${publishFlips.length} publish flip${publishFlips.length > 1 ? 's' : ''}`);
  if (fieldEdits.length) staged.push(`${fieldEdits.length} frontmatter edit${fieldEdits.length > 1 ? 's' : ''}`);
  const stagedLine = staged.length
    ? `  ${tint('warn', `staged: ${staged.join(' + ')} · press ${SAVE_KEY} to save`)}`
    : `  ${tint('muted', 'no staged changes')}`;

  return { head, body, focus, foot: frameFoot(model, cols, [stagedLine, ''], listFooter(model, cols)) };
}

export function detailFrame(model: Model): Frame {
  const cols = terminalColumns();
  const labelWidth = Math.max(...FIELDS.map((f) => f.label.length)) + 2;
  const valueWidth = Math.max(8, cols - labelWidth - 8);
  const item = current(model);
  const state = publishState(model, item);
  const slot = model.cursor < model.divider ? `featured slot ${model.cursor + 1}` : 'not featured';
  const head = frameHead(model, cols, `  ${tint('strong', item.slug)}  ${mark(state.glyph)} ${tint('muted', `${state.words} · ${slot}`)}`);

  const body = FIELDS.map((f, i) => {
    const focused = i === model.field;
    const editing = focused && model.mode === 'edit';
    const pointer = focused ? mark(GLYPH.pointer) : ' ';
    const stagedMark = f.key in item.edits ? mark(GLYPH.edited) : ' ';
    const label = tint(focused && !editing ? 'strong' : f.editable ? 'plain' : 'muted', f.label.padEnd(labelWidth));
    if (editing) return `  ${pointer} ${stagedMark}${label}${lineEditor(model.input, model.inputCursor, valueWidth)}`;
    const raw = fieldValue(item, f) || (f.editable ? tint('muted', '(empty)') : '');
    const note = f.note ? `  (${f.note})` : '';
    const value = truncate(raw, Math.max(1, valueWidth - note.length)) + (note ? tint('muted', note) : '');
    return `  ${pointer} ${stagedMark}${label}${f.key in item.edits ? tint('warn', value) : value}`;
  });

  const issues = model.issues.get(item.slug) ?? [];
  if (issues.length) body.push('', ...issues.slice(0, 6).map((issue) => `    ${mark(GLYPH.issue)} ${issue}`));

  const hints =
    model.mode === 'edit'
      ? wrapHints('type to edit', keyHints(model), cols)
      : wrapHints('', [...keyHints(model), `changes save with ${SAVE_KEY} on the list screen`], cols);
  return { head, body, focus: model.field, foot: frameFoot(model, cols, [], hints) };
}

const actionLabel = (action: SiteAction, status: SiteStatus): string => (typeof action.label === 'function' ? action.label(status) : action.label);

const row = (label: string, value: string): string => `    ${label.padEnd(21)}${value}`;

function statusRows(status: SiteStatus, cols: number): string[] {
  const rows = [
    row(
      'Astro Dev Server',
      status.devServer
        ? `${mark(GLYPH.filled)} ${tint('ok', 'Running')} on ${status.devServer.url}`
        : `${mark(GLYPH.hollow, 'muted')} ${tint('muted', 'Offline')}`,
    ),
    '',
    row(
      'Git Working Tree',
      status.gitChanges > 0 ? tint('warn', `${GLYPH.filled.char} ${status.gitChanges} uncommitted changes`) : tint('ok', `${GLYPH.filled.char} clean`),
    ),
    row('Git Branch', `${status.gitBranch} ${tint('muted', `(${status.gitAheadBehind})`)}`),
  ];
  if (status.commitHash) {
    const subject = truncate(status.commitSubject, cols - 40);
    rows.push(row('Last Commit', `${tint('accent', status.commitHash)} ${subject} ${tint('muted', `(${status.commitAge})`)}`));
  }
  rows.push(
    row('Astro Build (dist)', tint(status.build.tone, `${GLYPH.filled.char} ${status.build.text}`)),
    row('Security Signature', tint(status.security.tone, `${GLYPH.filled.char} ${status.security.text}`)),
    row(
      'Live Site',
      status.live.code === null
        ? tint('muted', `${GLYPH.hollow.char} unreachable`)
        : `${tint(status.live.tone, `${GLYPH.filled.char} HTTP ${status.live.code}`)} ${tint('muted', SITE_ORIGIN)}`,
    ),
  );
  return rows;
}

function contentRows(model: Model): string[] {
  const published = model.items.filter((i) => i.published).length;
  const drafts = model.items.length - published;
  const failing = (i: Item): boolean => (model.issues.get(i.slug)?.length ?? 0) > 0;
  const gatedPub = model.items.filter((i) => i.published && failing(i)).length;
  const gatedDraft = model.items.filter((i) => !i.published && failing(i)).length;
  const dot = tint('muted', '·');
  const gate: string[] = [];
  if (gatedPub) gate.push(tint('error', `${GLYPH.issue.char} ${gatedPub} published writeup${gatedPub === 1 ? '' : 's'} failing the gate`));
  if (gatedDraft) gate.push(tint('warn', `${GLYPH.issue.char} ${gatedDraft} draft${gatedDraft === 1 ? '' : 's'} not ready to publish`));
  return [
    row('Writeups', `${published} published ${dot} ${drafts} draft${drafts === 1 ? '' : 's'} ${dot} ${model.divider} featured`),
    row('Publish Gate', gate.length ? gate.join(` ${dot} `) : tint('ok', `${GLYPH.filled.char} all writeups pass`)),
  ];
}

export function siteFrame(model: Model): Frame {
  const cols = terminalColumns();
  const status = model.siteStatus;
  const head = frameHead(model, cols, `  ${tint('strong', 'site manage')}${tint('muted', ': manage local servers, pre-flight checks, and publish')}`);
  if (!status) {
    const note = model.flash ?? { tone: 'plain', text: 'Site status has not been loaded.' };
    return { head, body: [`  ${tint(note.tone, note.text)}`], foot: [], focus: 0 };
  }

  const body = [
    `  ${tint('strong', 'SYSTEM STATUS')}  ${tint('muted', `as of ${status.loadedAt}`)}`,
    '',
    ...statusRows(status, cols),
    '',
    `  ${tint('strong', 'CONTENT')}`,
    '',
    ...contentRows(model),
    '',
    `  ${tint('strong', 'INTERACTIVE ACTIONS')}`,
    '',
  ];
  const focus = body.length + model.actionCursor;
  SITE_ACTIONS.forEach((action, i) => {
    const selected = i === model.actionCursor;
    const label = actionLabel(action, status).padEnd(20);
    const desc = truncate(model.descriptions.get(action.key) ?? '', Math.max(10, cols - 34));
    body.push(
      `  ${selected ? mark(GLYPH.pointer) : ' '} ${tint('accent', `[${action.key}]`)} ${tint(selected ? 'strong' : 'plain', label)} ${tint('muted', desc)}`,
    );
  });

  return { head, body, focus, foot: frameFoot(model, cols, [], wrapHints('', keyHints(model), cols)) };
}

export function currentFrame(model: Model): Frame {
  if (model.tab === 'site') return siteFrame(model);
  if (model.mode === 'detail' || model.mode === 'edit') return detailFrame(model);
  return listFrame(model);
}
