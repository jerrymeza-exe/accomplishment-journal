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

/* One message per way a link can fail. They are separate strings rather than
   one apology because only `unreadable` is worth acting on, and the person
   reading it is usually not the person who can act. */
const REFUSALS = {
  'no-link': {
    title: 'Nothing to show',
    body: 'This page displays a shared accomplishment log. The link you followed does not include one.',
  },
  unreadable: {
    title: 'This link is incomplete',
    body: 'Long links are sometimes broken in transit by email programs and chat apps. Ask whoever sent it for a fresh copy, ideally as a clickable link rather than pasted text.',
  },
  'unsupported-version': {
    title: 'This link needs a newer page',
    body: 'It was made by a later version of the Accomplishment Journal than this page can read. Ask whoever sent it for a fresh copy.',
  },
  'unsupported-browser': {
    title: 'This browser cannot open the link',
    body: 'Reading a shared log needs a browser from 2023 or later — Chrome 80, Safari 16.4, Firefox 113, or anything newer. The link itself is fine.',
  },
};

function renderRefusal(reason) {
  const { title, body } = REFUSALS[reason] ?? REFUSALS.unreadable;
  document.title = `${title} — Accomplishment Log`;
  sheet.replaceChildren(
    h('div', { class: 'refusal' },
      h('h1', {}, title),
      h('p', {}, body),
    ),
  );
}

async function start() {
  const result = await readSnapshot(window.location.hash);
  if (result.ok) renderSnapshot(result.snapshot);
  else renderRefusal(result.reason);
}

start();
