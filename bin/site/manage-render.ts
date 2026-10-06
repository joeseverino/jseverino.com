// site manage's frames: pure functions of the model that return the screen as
// a string. The terminal-size getters read the MANAGE_TUI_* test overrides;
// the other terminal helpers are in ./tui.ts.
import { RESET, BOLD, DIM, INVERT, GREEN, YELLOW, RED, CYAN, MAGENTA, truncate, lineEditor } from './tui.ts';
import { DEV_PORT } from './dev-server.ts';
import { SITE_ORIGIN } from '../../src/lib/site-config.ts';
import { FIELDS, current, diff, fieldValue, hasStaged, loadSiteStatus, type Item, type Model, type SiteStatus } from './manage-model.ts';

// The horizontal rule under a frame's header and between its sections.
export const rule = (cols: number): string => '─'.repeat(Math.max(40, cols - 4));

// The divider between the featured list and the writeups that are not featured.
const notFeaturedDivider = (cols: number): string => `  ${DIM}──── not featured ${'─'.repeat(Math.max(4, cols - 22))}${RESET}`;

const TEST_COLUMNS = Number.parseInt(process.env.MANAGE_TUI_COLUMNS || '', 10);
const TEST_ROWS = Number.parseInt(process.env.MANAGE_TUI_ROWS || '', 10);

export function drawTabBar(model: Model): string {
  const writeupsActive = model.tab === 'writeups';
  const siteActive = model.tab === 'site';
  const writeupsLabel = `  Writeups (${model.items.length})  `;

  const writeupsTab = writeupsActive
    ? `${BOLD}${INVERT}${writeupsLabel}${RESET}`
    : `${DIM}${writeupsLabel}${RESET}`;

  const siteTab = siteActive
    ? `${BOLD}${INVERT}  Site  ${RESET}`
    : `${DIM}  Site  ${RESET}`;

  return `  ${writeupsTab}  ${siteTab}`;
}

// The Site tab's actions as the frame lists them; manage.ts maps each key to
// what it runs.
export interface SiteActionSpec {
  key: string;
  label: string;
  desc: string;
}

export function siteActionSpecs(status: Partial<SiteStatus>): SiteActionSpec[] {
  return [
    { key: 'd', label: status.devServerOpen ? 'Stop Dev Server' : 'Start Dev Server', desc: `starts/stops Astro at port ${DEV_PORT}` },
    { key: 'h', label: 'Status', desc: 'repository, dependencies, vault, open content PRs' },
    { key: 'v', label: 'Validate', desc: 'the publish gate over every published writeup' },
    { key: 'g', label: 'Run Diagnose', desc: 'the collect-all gate: every audit in one pass' },
    { key: 'b', label: 'Build Site', desc: 'type-check and the static build' },
    { key: 't', label: 'Run Tests', desc: 'Playwright suite' },
    { key: 'p', label: 'Publish', desc: 'open a content PR from the vault (merge with site land)' },
  ];
}

export function terminalColumns(): number {
  return Number.isFinite(TEST_COLUMNS) && TEST_COLUMNS > 0
    ? TEST_COLUMNS
    : process.stdout.columns || 110;
}

export function terminalRows(): number {
  return Number.isFinite(TEST_ROWS) && TEST_ROWS > 0
    ? TEST_ROWS
    : process.stdout.rows || 30;
}

function stateIcon(model: Model, item: Item): string {
  const flipped = item.published !== model.origPublished.get(item.slug);
  if (item.published) return flipped ? `${GREEN}▲${RESET}` : `${GREEN}●${RESET}`;
  return flipped ? `${YELLOW}▼${RESET}` : `${MAGENTA}◌${RESET}`;
}

function stateTag(model: Model, item: Item): { plain: string; text: string } {
  const flipped = item.published !== model.origPublished.get(item.slug);
  if (item.published && flipped) return { plain: '[will publish]  ', text: `${GREEN}[will publish]  ${RESET}` };
  if (!item.published && flipped) return { plain: '[will unpublish]  ', text: `${YELLOW}[will unpublish]  ${RESET}` };
  if (!item.published) return { plain: '[draft]  ', text: `${MAGENTA}[draft]  ${RESET}` };
  return { plain: '', text: '' };
}

export function listFrame(model: Model): string {
  const cols = terminalColumns();
  const slugWidth = Math.max(...model.items.map((i) => i.slug.length), 10) + 2;
  const out: string[] = [];

  out.push('');
  out.push(drawTabBar(model));
  out.push(`  ${rule(cols)}`);
  out.push(`  ${BOLD}site manage${RESET}${DIM}: ${GREEN}●${RESET}${DIM} published · ${MAGENTA}◌${RESET}${DIM} draft · ${RED}!${RESET}${DIM} gate issues · edits stay staged until you save${RESET}`);
  out.push('');
  out.push(`  ${BOLD}FEATURED${RESET}  ${DIM}home page renders this order${RESET}`);

  model.items.forEach((item, idx) => {
    if (idx === model.divider) {
      out.push(notFeaturedDivider(cols));
    }
    const selected = idx === model.cursor;
    const grabbed = selected && model.mode === 'move';
    const pointer = selected ? `${CYAN}▸${RESET}` : ' ';
    const slot = idx < model.divider ? `${CYAN}${String(idx + 1).padStart(2)}${RESET}` : `${DIM} ·${RESET}`;
    const tag = stateTag(model, item);
    const gateMark = (model.issues.get(item.slug) || []).length ? `${RED}!${RESET}` : ' ';
    const edited = Object.keys(item.edits).length ? `${YELLOW}*${RESET}` : ' ';
    let slugText = item.slug.padEnd(slugWidth);
    if (grabbed) slugText = `${INVERT}${slugText}${RESET}`;
    else if (selected) slugText = `${BOLD}${slugText}${RESET}`;
    const title = `${DIM}${truncate(item.title, cols - slugWidth - tag.plain.length - 15)}${RESET}`;
    out.push(`  ${pointer} ${slot} ${stateIcon(model, item)} ${gateMark}${edited}${slugText}${tag.text}${title}`);
  });
  if (model.divider === model.items.length) {
    out.push(notFeaturedDivider(cols));
  }
  {
    const selNew = model.cursor === model.items.length;
    const pointer = selNew ? `${CYAN}▸${RESET}` : ' ';
    const label = selNew ? `${BOLD}new writeup…${RESET}` : `${DIM}new writeup…${RESET}`;
    out.push(`  ${pointer} ${DIM} +${RESET}     ${label}`);
  }

  out.push('');
  if (model.flash) {
    out.push(`  ${model.flash}`);
    out.push('');
  }

  const { featuredChanged, publishFlips, fieldEdits } = diff(model);
  const staged: string[] = [];
  if (featuredChanged) staged.push('featured order');
  if (publishFlips.length) staged.push(`${publishFlips.length} publish flip${publishFlips.length > 1 ? 's' : ''}`);
  if (fieldEdits.length) staged.push(`${fieldEdits.length} frontmatter edit${fieldEdits.length > 1 ? 's' : ''}`);
  out.push(
    staged.length
      ? `  ${YELLOW}staged: ${staged.join(' + ')} · press s to save${RESET}`
      : `  ${DIM}no staged changes${RESET}`,
  );
  out.push('');

  out.push(`  ${DIM}${rule(cols)}${RESET}`);
  if (model.mode === 'move') {
    const slug = model.items[model.cursor]?.slug || '';
    out.push(`  ${BOLD}moving ${slug}${RESET}${DIM}: ↑/↓ move · crossing the line features/unfeatures · space or enter drops it${RESET}`);
  } else if (model.mode === 'new') {
    out.push(`  ${BOLD}new writeup slug:${RESET} ${lineEditor(model.input, model.inputCursor, Math.max(8, cols - 24))}`);
    out.push(`  ${DIM}lowercase-kebab-case → becomes jseverino.com/portfolio/<slug>/ · enter create · esc cancel${RESET}`);
  } else if (model.mode === 'confirm-quit') {
    out.push(`  ${YELLOW}unsaved changes: s save and exit · d discard and exit · esc keep working${RESET}`);
  } else if (model.mode === 'confirm-reload') {
    out.push(`  ${YELLOW}unsaved changes will be lost: press y or r to reload · esc keep working${RESET}`);
  } else if (model.cursor === model.items.length) {
    const saveHint = hasStaged(model) ? ' · s save' : '';
    out.push(`  ${DIM}↑/↓ select · enter create a new writeup · → site tab · Ctrl+R reload${saveHint} · q quit${RESET}`);
  } else {
    const saveHint = hasStaged(model) ? ' · s save' : '';
    out.push(`  ${DIM}↑/↓ select · enter open · space move · f feature/unfeature · p publish/unpublish${RESET}`);
    out.push(`  ${DIM}n new writeup · o open in Obsidian · → site tab · Ctrl+R reload${saveHint} · q quit${RESET}`);
  }
  return out.join('\n');
}

export function detailFrame(model: Model): string {
  const cols = terminalColumns();
  const labelWidth = Math.max(...FIELDS.map((f) => f.label.length)) + 2;
  const valueWidth = Math.max(8, cols - labelWidth - 8);
  const item = current(model);
  const idx = model.cursor;
  const slot = idx < model.divider ? `featured slot ${idx + 1}` : 'not featured';
  const out: string[] = [];

  out.push('');
  out.push(drawTabBar(model));
  out.push(`  ${rule(cols)}`);
  out.push(`  ${BOLD}${item.slug}${RESET}  ${stateIcon(model, item)} ${DIM}${item.published ? 'published' : 'draft'} · ${slot}${RESET}`);
  out.push('');

  FIELDS.forEach((f, i) => {
    const selected = i === model.field && model.mode !== 'edit';
    const editing = i === model.field && model.mode === 'edit';
    const pointer = selected || editing ? `${CYAN}▸${RESET}` : ' ';
    const stagedMark = f.key in item.edits ? `${YELLOW}*${RESET}` : ' ';
    const label = (selected ? BOLD : f.editable ? '' : DIM) + f.label.padEnd(labelWidth) + RESET;
    let value;
    if (editing) {
      value = lineEditor(model.input, model.inputCursor, valueWidth);
    } else {
      const raw = fieldValue(item, f) || (f.editable ? `${DIM}(empty)${RESET}` : '');
      const note = f.note ? `  (${f.note})` : '';
      const rawWidth = Math.max(1, valueWidth - note.length);
      value = truncate(raw, rawWidth) + (note ? `  ${DIM}(${f.note})${RESET}` : '');
      if (f.key in item.edits) value = `${YELLOW}${value}${RESET}`;
    }
    out.push(`  ${pointer} ${stagedMark}${label}${value}`);
  });

  const issues = model.issues.get(item.slug) || [];
  if (issues.length) {
    out.push('');
    for (const issue of issues.slice(0, 6)) out.push(`    ${RED}!${RESET} ${issue}`);
  }

  out.push('');
  if (model.flash) {
    out.push(`  ${model.flash}`);
    out.push('');
  }
  out.push(`  ${DIM}${rule(cols)}${RESET}`);
  if (model.mode === 'edit') {
    out.push(`  ${DIM}type to edit · ←/→ move · enter stage · esc cancel · Ctrl+U clear · Ctrl+W delete word${RESET}`);
  } else {
    out.push(`  ${DIM}↑/↓ field · enter edit · p publish/unpublish · t touch last_reviewed · r revert changes${RESET}`);
    out.push(`  ${DIM}o open in Obsidian · Ctrl+R reload · esc back · changes save with s on list screen${RESET}`);
  }
  return out.join('\n');
}

export function siteFrame(model: Model): string {
  const cols = terminalColumns();
  const out: string[] = [];
  const status = model.siteStatus ??= loadSiteStatus();
  
  out.push('');
  out.push(drawTabBar(model));
  out.push(`  ${rule(cols)}`);
  out.push(`  ${BOLD}site manage${RESET}${DIM}: manage local servers, pre-flight checks, and publish${RESET}`);
  out.push('');

  out.push(`  ${BOLD}SYSTEM STATUS${RESET}  ${DIM}as of ${status.loadedAt}${RESET}`);
  out.push('');

  const devStatus = status.devServerOpen
    ? `${GREEN}● Running${RESET} on http://127.0.0.1:${DEV_PORT}`
    : `${DIM}◌ Offline${RESET}`;
  out.push(`    Astro Dev Server     ${devStatus}`);

  out.push('');

  const gitStatusColor = status.gitChanges > 0 ? YELLOW : GREEN;
  const gitStatusText = status.gitChanges > 0
    ? `${gitStatusColor}● ${status.gitChanges} uncommitted changes${RESET}`
    : `${GREEN}● clean${RESET}`;
  out.push(`    Git Working Tree     ${gitStatusText}`);

  const gitBranchText = `${status.gitBranch} ${DIM}(${status.gitAheadBehind})${RESET}`;
  out.push(`    Git Branch           ${gitBranchText}`);

  if (status.commitHash) {
    const subject = truncate(status.commitSubject, cols - 40);
    out.push(`    Last Commit          ${CYAN}${status.commitHash}${RESET} ${subject} ${DIM}(${status.commitAge})${RESET}`);
  }

  const buildColor = status.distStatus.startsWith('Present') ? GREEN : DIM;
  out.push(`    Astro Build (dist)   ${buildColor}● ${status.distStatus}${RESET}`);

  const secColor = status.securityStatus.includes('expires') ? GREEN : RED;
  out.push(`    Security Signature   ${secColor}● ${status.securityStatus}${RESET}`);

  const liveText = !status.liveCode
    ? `${DIM}◌ unreachable${RESET}`
    : /^[23]/.test(status.liveCode)
      ? `${GREEN}● HTTP ${status.liveCode}${RESET} ${DIM}${SITE_ORIGIN}${RESET}`
      : `${RED}● HTTP ${status.liveCode}${RESET} ${DIM}${SITE_ORIGIN}${RESET}`;
  out.push(`    Live Site            ${liveText}`);

  out.push('');
  out.push(`  ${BOLD}CONTENT${RESET}`);
  out.push('');

  const published = model.items.filter((i) => i.published).length;
  const drafts = model.items.length - published;
  const gatedPub = model.items.filter((i) => i.published && (model.issues.get(i.slug) || []).length > 0).length;
  const gatedDraft = model.items.filter((i) => !i.published && (model.issues.get(i.slug) || []).length > 0).length;
  out.push(`    Writeups             ${published} published ${DIM}·${RESET} ${drafts} draft${drafts === 1 ? '' : 's'} ${DIM}·${RESET} ${model.divider} featured`);
  const gateParts: string[] = [];
  if (gatedPub) gateParts.push(`${RED}! ${gatedPub} published writeup${gatedPub === 1 ? '' : 's'} failing the gate${RESET}`);
  if (gatedDraft) gateParts.push(`${YELLOW}! ${gatedDraft} draft${gatedDraft === 1 ? '' : 's'} not ready to publish${RESET}`);
  out.push(`    Publish Gate         ${gateParts.length ? gateParts.join(`${DIM} · ${RESET}`) : `${GREEN}● all writeups pass${RESET}`}`);

  out.push('');
  out.push(`  ${BOLD}INTERACTIVE ACTIONS${RESET}`);
  out.push('');

  siteActionSpecs(status).forEach((a, i) => {
    const selected = i === model.actionCursor;
    const pointer = selected ? `${CYAN}▸${RESET}` : ' ';
    const label = selected ? `${BOLD}${a.label.padEnd(20)}${RESET}` : a.label.padEnd(20);
    out.push(`  ${pointer} ${CYAN}[${a.key}]${RESET} ${label} ${DIM}${a.desc}${RESET}`);
  });

  out.push('');
  if (model.flash) {
    out.push(`  ${model.flash}`);
    out.push('');
  }

  out.push(`  ${DIM}${rule(cols)}${RESET}`);
  out.push(`  ${DIM}↑/↓ select · enter run · ←/→ switch tabs · r reload status · q quit${RESET}`);
  
  return out.join('\n');
}

export function currentFrame(model: Model): string {
  if (model.tab === 'site') return siteFrame(model);
  if (model.mode === 'detail' || model.mode === 'edit') return detailFrame(model);
  return listFrame(model);
}

