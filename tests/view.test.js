/* Tests for the journal view model (`static/view.js`).
 *
 * Run from the project root:
 *
 *   node --test
 *
 * These derivations used to exist only as DOM inside two renderers that could
 * disagree with each other. They are data now, so grouping, sequence numbers
 * and the move-up/move-down flags can be asserted without a browser.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { journalView, formatStamp } from '../static/view.js';

const UI = { activeProjectId: 'p1', query: '', grouping: 'date' };

function project(id, extra = {}) {
  return {
    id,
    name: `Project ${id}`,
    description: '',
    startedOn: '2026-01-05',
    tags: [],
    updatedAt: '2026-02-10T09:00:00.000Z',
    ...extra,
  };
}

function entry(id, extra = {}) {
  return {
    id,
    projectId: 'p1',
    title: `Entry ${id}`,
    date: '2026-03-01',
    milestone: '',
    markdown: '',
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
    ...extra,
  };
}

function view(state, ui = {}) {
  return journalView(state, { ...UI, ...ui });
}

/* --- stamps -------------------------------------------------------------- */

test('a stamp is the field-log format', () => {
  assert.equal(formatStamp('2026-08-30'), '30 AUG 2026');
  assert.equal(formatStamp('2026-01-05'), '05 JAN 2026');
});

test('a missing date reads as NO DATE rather than a wrong one', () => {
  assert.equal(formatStamp(''), 'NO DATE');
  assert.equal(formatStamp(undefined), 'NO DATE');
});

/* --- the rail ------------------------------------------------------------ */

test('the rail counts every project and every project its entries', () => {
  const state = {
    projects: [project('p1'), project('p2')],
    achievements: [entry('a'), entry('b'), entry('c', { projectId: 'p2' })],
  };
  const { rail } = view(state);
  assert.equal(rail.total, 2);
  assert.deepEqual(rail.rows.map((row) => [row.id, row.count]), [['p1', 2], ['p2', 1]]);
  assert.deepEqual(rail.rows.map((row) => row.current), [true, false]);
});

test('the rail count and the log count cannot disagree', () => {
  const state = {
    projects: [project('p1')],
    achievements: [entry('a'), entry('b'), entry('c')],
  };
  const model = view(state);
  assert.equal(model.rail.rows[0].count, model.active.entryCount);
});

test('the view model exposes journal organization without workflow metadata', () => {
  const state = { projects: [project('p1')], achievements: [entry('a')] };
  const model = view(state);
  assert.equal('status' in model.rail.rows[0], false);
  assert.equal('progress' in model.active, false);
});

test('the filter matches name, description and tags', () => {
  const state = {
    projects: [
      project('p1', { name: 'Signals' }),
      project('p2', { name: 'Other', description: 'about signals' }),
      project('p3', { name: 'Third', tags: ['signals', 'review'] }),
      project('p4', { name: 'Unrelated' }),
    ],
    achievements: [],
  };
  assert.deepEqual(view(state, { query: '  SIGNALS ' }).rail.rows.map((row) => row.id), ['p1', 'p2', 'p3']);
});

test('an empty rail says which kind of empty it is', () => {
  assert.equal(view({ projects: [], achievements: [] }).rail.empty, 'no-projects');
  assert.equal(view({ projects: [project('p1')], achievements: [] }, { query: 'zzz' }).rail.empty, 'no-match');
  assert.equal(view({ projects: [project('p1')], achievements: [] }).rail.empty, null);
});

/* --- the active project -------------------------------------------------- */

test('no active project means nothing to render', () => {
  const model = view({ projects: [project('p1')], achievements: [] }, { activeProjectId: '' });
  assert.equal(model.active, null);
  assert.equal(model.rail.total, 1);
});

test('the active project carries its stamps', () => {
  const model = view({ projects: [project('p1')], achievements: [] });
  assert.equal(model.active.startedStamp, '05 JAN 2026');
  assert.equal(model.active.updatedStamp, '10 FEB 2026');
});

/* --- grouping and numbering ---------------------------------------------- */

test('grouping by date buckets by day, newest group first', () => {
  const state = {
    projects: [project('p1')],
    achievements: [
      entry('a', { date: '2026-03-02' }),
      entry('b', { date: '2026-03-01' }),
      entry('c', { date: '2026-03-01' }),
    ],
  };
  const { groups } = view(state).active;
  assert.deepEqual(groups.map((group) => [group.label, group.count]), [
    ['02 MAR 2026', 1],
    ['01 MAR 2026', 2],
  ]);
});

test('grouping by milestone puts unlabelled entries under Unassigned', () => {
  const state = {
    projects: [project('p1')],
    achievements: [
      entry('a', { milestone: 'Phase 1' }),
      entry('b', { milestone: '' }),
      entry('c', { milestone: 'Phase 1' }),
    ],
  };
  const { groups } = view(state, { grouping: 'milestone' }).active;
  assert.deepEqual(groups.map((group) => [group.label, group.count]), [['Phase 1', 2], ['Unassigned', 1]]);
});

test('the side column shows whatever the log is not grouped by', () => {
  const state = { projects: [project('p1')], achievements: [entry('a', { milestone: 'Phase 1', date: '2026-03-02' })] };
  assert.equal(view(state, { grouping: 'date' }).active.groups[0].rows[0].aside, 'Phase 1');
  assert.equal(view(state, { grouping: 'milestone' }).active.groups[0].rows[0].aside, '02 MAR 2026');
});

test('an entry with no milestone shows a dash when grouped by date', () => {
  const state = { projects: [project('p1')], achievements: [entry('a', { milestone: '' })] };
  assert.equal(view(state).active.groups[0].rows[0].aside, '—');
});

test('the first record ever written keeps the lowest log number', () => {
  const state = {
    projects: [project('p1')],
    achievements: [entry('newest'), entry('middle'), entry('oldest')],
  };
  const rows = view(state).active.groups.flatMap((group) => group.rows);
  assert.deepEqual(rows.map((row) => [row.entry.id, row.sequence]), [
    ['newest', 3], ['middle', 2], ['oldest', 1],
  ]);
});

test('numbering follows position, so a reorder renumbers', () => {
  const before = view({ projects: [project('p1')], achievements: [entry('a'), entry('b')] });
  const after = view({ projects: [project('p1')], achievements: [entry('b'), entry('a')] });
  const seq = (model) => Object.fromEntries(
    model.active.groups.flatMap((group) => group.rows).map((row) => [row.entry.id, row.sequence]));
  assert.deepEqual(seq(before), { a: 2, b: 1 });
  assert.deepEqual(seq(after), { b: 2, a: 1 });
});

/* --- move eligibility ----------------------------------------------------- */

test('the ends of a log cannot move past themselves', () => {
  const state = { projects: [project('p1')], achievements: [entry('a'), entry('b'), entry('c')] };
  const rows = view(state).active.groups.flatMap((group) => group.rows);
  assert.deepEqual(rows.map((row) => [row.canMoveUp, row.canMoveDown]), [
    [false, true], [true, true], [true, false],
  ]);
});

test('a lone entry can move neither way', () => {
  const [row] = view({ projects: [project('p1')], achievements: [entry('a')] }).active.groups[0].rows;
  assert.equal(row.canMoveUp, false);
  assert.equal(row.canMoveDown, false);
});

test('move eligibility follows the whole log, not the group', () => {
  /* Grouped by milestone the first entry sits alone in its group, but it is
     still the top of the log and still cannot move up. */
  const state = {
    projects: [project('p1')],
    achievements: [entry('a', { milestone: 'Phase 2' }), entry('b', { milestone: 'Phase 1' }), entry('c', { milestone: 'Phase 1' })],
  };
  const groups = view(state, { grouping: 'milestone' }).active.groups;
  assert.equal(groups[0].rows[0].canMoveUp, false);
  assert.equal(groups[0].rows[0].canMoveDown, true);
  assert.equal(groups[1].rows.at(-1).canMoveDown, false);
});

test('a project with no entries has no groups', () => {
  const model = view({ projects: [project('p1')], achievements: [] });
  assert.equal(model.active.entryCount, 0);
  assert.deepEqual(model.active.groups, []);
});

test('other projects entries never reach the active log', () => {
  const state = {
    projects: [project('p1'), project('p2')],
    achievements: [entry('a'), entry('b', { projectId: 'p2' })],
  };
  const rows = view(state).active.groups.flatMap((group) => group.rows);
  assert.deepEqual(rows.map((row) => row.entry.id), ['a']);
});
