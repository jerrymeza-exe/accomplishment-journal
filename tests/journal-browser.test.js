import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EMPTY_JOURNAL, applyOperation, normalizeBackup, projectCsv } from '../static/journal.js';

function createProject(state = EMPTY_JOURNAL, name = 'Launch Work') {
  return applyOperation(state, {
    op: 'create_project',
    name,
    description: 'Release notes',
    startedOn: '2026-09-02',
    tags: ['shipping', 'shipping', ' mobile '],
  });
}

test('the Pages journal can create a project and normalize its tags', () => {
  const result = createProject();
  assert.match(result.createdId, /^project-/);
  assert.equal(result.state.projects[0].name, 'Launch Work');
  assert.deepEqual(result.state.projects[0].tags, ['shipping', 'mobile']);
});

test('the Pages journal can record and reorder entries', () => {
  const project = createProject();
  const first = applyOperation(project.state, {
    op: 'record_entry', projectId: project.createdId, title: 'First', date: '2026-09-01',
    milestone: '', markdown: 'First result',
  });
  const second = applyOperation(first.state, {
    op: 'record_entry', projectId: project.createdId, title: 'Second', date: '2026-09-02',
    milestone: 'Launch', markdown: 'Second result',
  });
  assert.deepEqual(second.state.achievements.map((entry) => entry.title), ['Second', 'First']);

  const moved = applyOperation(second.state, { op: 'move_entry', id: second.createdId, direction: 1 });
  assert.deepEqual(moved.state.achievements.map((entry) => entry.title), ['First', 'Second']);
});

test('a downloaded v3 backup validates before restore', () => {
  const project = createProject();
  assert.deepEqual(normalizeBackup({ data: project.state }), project.state);
  assert.throws(() => normalizeBackup({ data: { ...project.state, version: 99 } }), /compatible/);
});

test('the Pages CSV matches the local export shape', async () => {
  const project = createProject(EMPTY_JOURNAL, 'Phone Launch');
  const entry = applyOperation(project.state, {
    op: 'record_entry', projectId: project.createdId, title: 'Published', date: '2026-09-02',
    milestone: 'Live', markdown: 'Opened on my phone',
  });
  const csv = projectCsv(entry.state, project.createdId);
  assert.equal(csv.name, 'phone-launch-log.csv');
  assert.equal(await csv.blob.text(), 'project,date,milestone,title,markdown\r\n"Phone Launch","2026-09-02","Live","Published","Opened on my phone"');
});

/* The hosted build is the only journal some people have: it has to read the
   older backup formats the Python app reads, or their milestones arrive
   blank — or, before this, not at all. */

const LEGACY_PROJECT = {
  id: 'project-a',
  name: 'Legacy Work',
  description: '',
  startedOn: '2025-01-01',
  tags: [],
  updatedAt: '2025-01-01T00:00:00.000Z',
};

test('a v1 backup restores, and its category becomes the milestone', () => {
  const restored = normalizeBackup({
    version: 1,
    projects: [LEGACY_PROJECT],
    achievements: [{
      id: 'e1', projectId: 'project-a', title: 'Kickoff', date: '2025-01-05',
      category: 'Delivery', description: 'Did the thing', impact: 'It worked',
      skills: ['python', 'Review'], notes: 'Coordinated with two teams.',
      createdAt: '2025-01-05T10:00:00.000Z', updatedAt: '2025-01-05T10:00:00.000Z',
    }],
  });

  assert.equal(restored.version, 3);
  assert.equal(restored.achievements[0].milestone, 'Delivery');
  assert.equal(
    restored.achievements[0].markdown,
    'Did the thing\n\n**Impact**\n\nIt worked\n\n- Tools / skills: python, Review\n\n> Coordinated with two teams.',
  );
});

test('a v1 entry with no category is filed under General', () => {
  const restored = normalizeBackup({
    version: 1,
    projects: [LEGACY_PROJECT],
    achievements: [{
      id: 'e1', projectId: 'project-a', title: 'Kickoff', date: '2025-01-05',
      category: '', description: 'Plain', impact: '', skills: [], notes: '',
      createdAt: '2025-01-05T10:00:00.000Z', updatedAt: '2025-01-05T10:00:00.000Z',
    }],
  });
  assert.equal(restored.achievements[0].milestone, 'General');
});

test('a v2 backup restores and drops the retired status field', () => {
  const restored = normalizeBackup({
    version: 2,
    projects: [{ ...LEGACY_PROJECT, status: 'Complete' }],
    achievements: [{
      id: 'e1', projectId: 'project-a', title: 'Kickoff', date: '2025-01-05',
      milestone: 'Delivery', markdown: '- [x] Did it',
      createdAt: '2025-01-05T10:00:00.000Z', updatedAt: '2025-01-05T10:00:00.000Z',
    }],
  });
  assert.equal(restored.version, 3);
  assert.equal(restored.achievements[0].milestone, 'Delivery');
  assert.ok(!('status' in restored.projects[0]));
});

test('a milestone still labelled category survives into the export', async () => {
  const restored = normalizeBackup({
    version: 3,
    projects: [LEGACY_PROJECT],
    achievements: [{
      id: 'e1', projectId: 'project-a', title: 'Kickoff', date: '2025-01-05',
      category: 'Delivery', markdown: 'Did it',
      createdAt: '2025-01-05T10:00:00.000Z', updatedAt: '2025-01-05T10:00:00.000Z',
    }],
  });
  assert.equal(restored.achievements[0].milestone, 'Delivery');

  const csv = projectCsv(restored, 'project-a');
  assert.equal(
    await csv.blob.text(),
    'project,date,milestone,title,markdown\r\n"Legacy Work","2025-01-05","Delivery","Kickoff","Did it"',
  );
});

test('an unknown journal version is still refused', () => {
  assert.throws(
    () => normalizeBackup({ version: 4, projects: [], achievements: [] }),
    /incompatible journal version/,
  );
});

test('an entry never imports with its writing blank', () => {
  /* No write path in this journal can produce an empty entry body, so an
     entry arriving without `markdown` is a v1-shaped entry in a file labelled
     v3. Its writing is still in the structured fields. */
  const entry = {
    id: 'e1', projectId: 'project-a', title: 'Kickoff', date: '2025-01-05',
    createdAt: '2025-01-05T10:00:00.000Z', updatedAt: '2025-01-05T10:00:00.000Z',
  };
  const restore = (achievement) => normalizeBackup({
    version: 3, projects: [LEGACY_PROJECT], achievements: [achievement],
  }).achievements[0];

  assert.equal(
    restore({
      ...entry, category: 'Delivery', description: 'Did the thing', impact: 'It worked',
      skills: ['python', 'Review'], notes: 'Coordinated with two teams.',
    }).markdown,
    'Did the thing\n\n**Impact**\n\nIt worked\n\n- Tools / skills: python, Review\n\n> Coordinated with two teams.',
  );

  // Writing the entry already has wins over the structured fields.
  assert.equal(restore({ ...entry, markdown: 'already fine', description: 'ignored' }).markdown, 'already fine');

  // Nothing to recover is still imported, still empty: a recovery, not a refusal.
  assert.equal(restore({ ...entry, markdown: '' }).markdown, '');
});
