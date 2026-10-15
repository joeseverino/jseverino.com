import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleManageKey, pasteManageInput } from '../../bin/site/manage-input.ts';
import { FIELDS, hasStaged, type Model } from '../../bin/site/manage-model.ts';
import { siteActionSpecs, siteFrame } from '../../bin/site/manage-render.ts';

const today = '2026-10-14';
const actions = siteActionSpecs({}).map((action) => action.key);
const press = (model: Model, key: string) => handleManageKey(model, key, today, actions);

function model(): Model {
  return {
    items: [
      { slug: 'alpha', title: 'Alpha', published: true, featured: true, edits: {} },
      { slug: 'beta', title: 'Beta', published: false, featured: false, edits: {} },
    ],
    divider: 1, cursor: 0, tab: 'writeups', mode: 'list', field: 0,
    input: '', inputCursor: 0, flash: '', created: [], issues: new Map(),
    origFeatured: ['alpha'], origPublished: new Map([['alpha', true], ['beta', false]]),
    siteStatus: null, actionCursor: 0, sourceFingerprint: 'fixture',
  };
}

test('moving a writeup across the divider stages the new order without requesting a write', () => {
  const state = model();
  for (const key of ['j', 'm', 'k', '\r']) assert.equal(press(state, key), undefined);
  assert.equal(state.divider, 2);
  assert.equal(state.mode, 'list');
  assert.deepEqual(state.origFeatured, ['alpha']);
  assert.ok(hasStaged(state));
});

test('quitting with staged edits requires an explicit save or discard', () => {
  for (const [key, save] of [['s', true], ['d', false]] as const) {
    const state = model();
    press(state, 'p');
    assert.equal(press(state, 'q'), undefined);
    assert.equal(state.mode, 'confirm-quit');
    const effect = press(state, key);
    assert.equal(effect?.type, 'exit');
    if (effect?.type === 'exit') assert.equal(effect.save, save);
  }
});

test('reload is immediate only when no edits would be lost', () => {
  const state = model();
  assert.deepEqual(press(state, 'r'), { type: 'reload' });
  press(state, 'f');
  assert.equal(press(state, '\x12'), undefined);
  assert.equal(state.mode, 'confirm-reload');
  press(state, 'n');
  assert.ok(hasStaged(state));
  press(state, 'r');
  assert.deepEqual(press(state, 'y'), { type: 'reload' });
  assert.equal(state.mode, 'list');
});

test('editing stages values, Escape cancels input, and restoring the original clears the edit', () => {
  const state = model();
  press(state, '\r');
  state.field = FIELDS.findIndex((field) => field.key === 'title');
  assert.ok(state.field >= 0);
  const edit = (text: string, end: string) => {
    press(state, '\r');
    press(state, '\x15');
    pasteManageInput(state, text);
    press(state, end);
  };
  edit('Updated', '\r');
  assert.equal(state.items[0]?.edits.title, 'Updated');
  edit('Cancelled', '\x1b');
  assert.equal(state.items[0]?.edits.title, 'Updated');
  edit('Alpha', '\r');
  assert.equal(hasStaged(state), false);
});

test('read-only fields cannot enter edit mode and touching a date uses the supplied date', () => {
  const state = model();
  state.mode = 'detail';
  state.field = FIELDS.findIndex((field) => !field.editable);
  assert.ok(state.field >= 0);
  press(state, '\r');
  assert.equal(state.mode, 'detail');
  assert.match(state.flash, /read-only/);
  press(state, 't');
  assert.equal(state.items[0]?.edits.lastReviewed, today);
});

test('new writeups request creation without changing the loaded rows', () => {
  const state = model();
  state.cursor = state.items.length;
  press(state, '\r');
  pasteManageInput(state, ' new-project ');
  assert.deepEqual(press(state, '\r'), { type: 'create', slug: 'new-project' });
  assert.equal(state.items.length, 2);
  assert.deepEqual(state.created, []);
});

test('line editing preserves grapheme boundaries and strips pasted control characters', () => {
  const state = model();
  press(state, 'n');
  pasteManageInput(state, 'a😀éb');
  press(state, '\x1b[D');
  press(state, '\x7f');
  assert.equal(state.input, 'a😀b');
  press(state, '\x7f');
  assert.equal(state.input, 'ab');
  assert.equal(state.inputCursor, 1);
  pasteManageInput(state, '\r\n\t\x00x');
  assert.equal(state.input, 'a  xb');
  press(state, '\x1b');
  pasteManageInput(state, 'ignored');
  assert.equal(state.input, 'a  xb');
});

test('site navigation returns effects and staged edits remain protected across tabs', () => {
  const state = model();
  press(state, 'p');
  assert.deepEqual(press(state, '\t'), { type: 'refresh', announce: false });
  assert.deepEqual(press(state, 'r'), { type: 'refresh', announce: true });
  press(state, 'j');
  assert.deepEqual(press(state, '\r'), { type: 'action', key: 'h' });
  assert.equal(press(state, 'q'), undefined);
  assert.equal(state.tab, 'writeups');
  assert.equal(state.mode, 'confirm-quit');
});

test('rendering an unloaded site tab does not probe or modify the model', () => {
  const state = model();
  state.tab = 'site';
  const before = structuredClone(state);
  assert.match(siteFrame(state), /Site status has not been loaded/);
  assert.deepEqual(state, before);
});
