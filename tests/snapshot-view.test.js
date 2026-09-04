/* Tests for the share page's view model (`static/snapshot-view.js`).
 *
 * Run from the project root:
 *
 *   node --test
 *
 * Same reasoning as tests/view.test.js: grouping, sequence numbers and stamps
 * are derivations, so they are asserted as data rather than by building DOM
 * and reading it back.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { snapshotView } from '../static/snapshot-view.js';

function snapshot(extra = {}) {
  return {
    version: 1,
    who: 'Gerardo Meza Jr.',
    grouping: 'date',
    project: { name: 'Platform Migration', description: 'Consolidating.', startedOn: '2026-01-05' },
    entries: [
      { title: 'Cut the release cycle', date: '2026-03-04', milestone: 'Delivery', markdown: 'Rebuilt it.' },
      { title: 'Second pass', date: '2026-03-04', milestone: '', markdown: 'Tidied up.' },
      { title: 'Kickoff', date: '2026-01-06', milestone: 'Design', markdown: 'Scoped the work.' },
    ],
    ...extra,
  };
}

test('the header carries the owner and the project, and nothing about editing', () => {
  const view = snapshotView(snapshot());
  assert.equal(view.who, 'Gerardo Meza Jr.');
  assert.equal(view.project.name, 'Platform Migration');
  assert.equal(view.startedStamp, '05 JAN 2026');
  assert.equal(view.entryCount, 3);
  /* `updatedStamp` would tell a recruiter when the file was last touched,
     which is an editing habit rather than work. It must not exist here. */
  assert.equal('updatedStamp' in view, false);
});

test('grouping by date buckets by day and shows the milestone alongside', () => {
  const view = snapshotView(snapshot());
  assert.deepEqual(view.groups.map((group) => group.label), ['04 MAR 2026', '06 JAN 2026']);
  assert.deepEqual(view.groups.map((group) => group.count), [2, 1]);
  assert.deepEqual(view.groups[0].rows.map((row) => row.aside), ['Delivery', '—']);
});

test('grouping by milestone buckets by milestone and shows the date alongside', () => {
  const view = snapshotView(snapshot({ grouping: 'milestone' }));
  assert.deepEqual(view.groups.map((group) => group.label), ['Delivery', 'Unassigned', 'Design']);
  assert.deepEqual(view.groups[0].rows.map((row) => row.aside), ['04 MAR 2026']);
});

/* Same rule as the app: the first record ever written keeps its number, so a
   snapshot and the journal it came from read alike. */
test('sequence numbers count down so the oldest entry stays 01', () => {
  const view = snapshotView(snapshot());
  assert.deepEqual(view.groups.flatMap((group) => group.rows).map((row) => row.sequence), [3, 2, 1]);
});

test('stored order is preserved rather than re-sorted', () => {
  const value = snapshot();
  value.entries.reverse();
  const view = snapshotView(value);
  assert.deepEqual(
    view.groups.flatMap((group) => group.rows).map((row) => row.entry.title),
    ['Kickoff', 'Second pass', 'Cut the release cycle'],
  );
});

test('a row carries no move affordances', () => {
  const [row] = snapshotView(snapshot()).groups[0].rows;
  assert.equal('canMoveUp' in row, false);
  assert.equal('canMoveDown' in row, false);
});
