/* Accomplishment Journal — the shared log.
 *
 * This page renders a snapshot and can do nothing else. It deliberately does
 * not import app.js or journal.js: a read-only view built by disabling things
 * is one forgotten flag away from being writable, whereas one that never loads
 * the mutating code cannot be.
 */

import { h } from './dom.js';
import { renderMarkdown } from './markdown.js';
import { readSnapshot } from './snapshot.js';
import { snapshotView } from './snapshot-view.js';

const sheet = document.querySelector('#sheet');

function pad(value) {
  return String(value).padStart(2, '0');
}

function entryNode(row) {
  return h('article', { class: 'entry' },
    h('div', { class: 'entry-top' },
      h('span', { class: 'mono entry-seq' }, pad(row.sequence)),
      h('span', { class: 'mono entry-aside' }, row.aside),
    ),
    h('h2', {}, row.entry.title),
    renderMarkdown(row.entry.markdown),
  );
}

function groupNode(group) {
  return h('section', { class: 'group' },
    h('div', { class: 'group-head' },
      h('span', { class: 'mono' }, group.label),
      h('b', { class: 'mono' }, pad(group.count)),
    ),
    group.rows.map(entryNode),
  );
}

function renderSnapshot(snapshot) {
  const view = snapshotView(snapshot);
  document.title = `${view.project.name} — Accomplishment Log`;

  sheet.replaceChildren(
    h('header', { class: 'head' },
      view.who && h('p', { class: 'mono head-who' }, view.who),
      h('h1', {}, view.project.name),
      view.project.description && h('p', { class: 'head-desc' }, view.project.description),
      h('div', { class: 'mono head-meta' },
        h('span', {}, `Started ${view.startedStamp}`),
        h('span', {}, `${pad(view.entryCount)} entries`),
      ),
    ),
    view.groups.map(groupNode),
  );
}

async function start() {
  const result = await readSnapshot(window.location.hash);
  if (result.ok) renderSnapshot(result.snapshot);
}

start();
