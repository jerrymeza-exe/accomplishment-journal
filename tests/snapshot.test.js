/* Tests for snapshots (`static/snapshot.js`).
 *
 * Run from the project root:
 *
 *   node --test
 *
 * A snapshot leaves this machine and cannot be withdrawn, so what it carries
 * is asserted field by field rather than by shape: an id or a timestamp that
 * slips into the payload is a privacy bug, not a cosmetic one.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SNAPSHOT_VERSION, snapshotFrom } from '../static/snapshot.js';

function journal() {
  return {
    version: 3,
    projects: [
      {
        id: 'project-a', name: 'Platform Migration',
        description: 'Consolidating legacy services.', startedOn: '2026-01-05',
        tags: ['needs-writeup', 'old-job'], updatedAt: '2026-04-01T09:00:00.000Z',
      },
      {
        id: 'project-b', name: 'Other', description: '', startedOn: '2026-02-01',
        tags: [], updatedAt: '2026-02-01T09:00:00.000Z',
      },
    ],
    achievements: [
      {
        id: 'entry-2', projectId: 'project-a', title: 'Cut the release cycle',
        date: '2026-03-04', milestone: 'Delivery', markdown: 'Rebuilt the pipeline.',
        createdAt: '2026-03-04T09:00:00.000Z', updatedAt: '2026-03-05T09:00:00.000Z',
      },
      {
        id: 'entry-1', projectId: 'project-a', title: 'Kickoff',
        date: '2026-01-06', milestone: '', markdown: 'Scoped the work.',
        createdAt: '2026-01-06T09:00:00.000Z', updatedAt: '2026-01-06T09:00:00.000Z',
      },
      {
        id: 'entry-3', projectId: 'project-b', title: 'Unrelated',
        date: '2026-02-02', milestone: '', markdown: 'Elsewhere.',
        createdAt: '2026-02-02T09:00:00.000Z', updatedAt: '2026-02-02T09:00:00.000Z',
      },
    ],
  };
}

test('a snapshot carries one project and only its own entries', () => {
  const snapshot = snapshotFrom(journal(), 'project-a', { who: 'Gerardo Meza Jr.' });
  assert.equal(snapshot.version, SNAPSHOT_VERSION);
  assert.equal(snapshot.who, 'Gerardo Meza Jr.');
  assert.equal(snapshot.project.name, 'Platform Migration');
  assert.deepEqual(snapshot.entries.map((entry) => entry.title), ['Cut the release cycle', 'Kickoff']);
});

/* The whole point of a purpose-built shape. A recruiter reading
   `tags: ["needs-writeup", "old-job"]` learns something nobody meant to say,
   and the timestamps describe editing habits rather than work. */
test('a snapshot carries no ids, no timestamps and no tags', () => {
  const snapshot = snapshotFrom(journal(), 'project-a', { who: 'G' });
  const serialized = JSON.stringify(snapshot);
  for (const leak of ['project-a', 'entry-1', 'createdAt', 'updatedAt', 'tags', 'needs-writeup']) {
    assert.equal(serialized.includes(leak), false, `snapshot leaked ${leak}`);
  }
  assert.deepEqual(Object.keys(snapshot.project), ['name', 'description', 'startedOn']);
  assert.deepEqual(Object.keys(snapshot.entries[0]), ['title', 'date', 'milestone', 'markdown']);
});

test('grouping defaults to date and only ever holds a value the view understands', () => {
  assert.equal(snapshotFrom(journal(), 'project-a', {}).grouping, 'date');
  assert.equal(snapshotFrom(journal(), 'project-a', { grouping: 'milestone' }).grouping, 'milestone');
  assert.equal(snapshotFrom(journal(), 'project-a', { grouping: 'nonsense' }).grouping, 'date');
});

test('a missing name is blank rather than absent', () => {
  assert.equal(snapshotFrom(journal(), 'project-a', {}).who, '');
  assert.equal(snapshotFrom(journal(), 'project-a', { who: '  G  ' }).who, 'G');
});

test('an unknown project cannot be snapshotted', () => {
  assert.throws(() => snapshotFrom(journal(), 'project-gone', {}), /no longer in this journal/);
});

/* An empty log renders as a page that reads "this person has no
   accomplishments". The button is disabled for this case (Task 8); this is
   the backstop behind it. */
test('a project with no entries cannot be snapshotted', () => {
  const state = journal();
  state.achievements = state.achievements.filter((entry) => entry.projectId !== 'project-a');
  assert.throws(() => snapshotFrom(state, 'project-a', {}), /no entries/);
});
