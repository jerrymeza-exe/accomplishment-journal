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
