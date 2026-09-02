/* Accomplishment Journal — client.
 *
 * A faithful vanilla-JS port of the original React app (`app/page.tsx` +
 * `components/markdown.tsx`). Python owns the data: every mutation is pushed
 * to the local server, which validates it and persists it to disk. This file
 * owns the UI state and mirrors the original component's behaviour.
 */

import { h } from './dom.js';
import { renderMarkdown } from './markdown.js';
import { journalView } from './view.js';
import {
  EMPTY_JOURNAL,
  applyOperation,
  backupBlob,
  loadJournal,
  normalizeBackup,
  projectCsv,
  quarantineJournal as quarantineLocalJournal,
  saveJournal,
} from './journal.js';

/* ---------------------------------------------------------------- helpers */

const $ = (selector, root = document) => root.querySelector(selector);
const HOSTED_ON_PAGES = window.location.hostname.endsWith('.github.io');

const pad = (value) => String(value).padStart(2, '0');

function toLocalDateInput(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function downloadFile(name, blob) {
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------ app state */

const app = {
  state: EMPTY_JOURNAL,
  hydrated: false,
  activeProjectId: '',
  query: '',
  grouping: 'date',
  railOpen: false,
  projectOpen: false,
  editingProject: null,
  entryOpen: false,
  editingEntry: null,
  focusMode: false,
  preview: true,
  /* Set when saved browser data is unreadable; nothing is written over it. */
  locked: false,
};

/* Draft mirrors while a form is open; the stable inputs hold the values. */
const projectForm = { name: '', description: '', startedOn: '', tags: '' };
const entryForm = { projectId: '', title: '', date: '', milestone: '', markdown: '' };

const refs = {};

/* -------------------------------------------------------------- rendering */

function adopt(payload) {
  app.state = payload.state ?? EMPTY_JOURNAL;
}

/* The one derivation of what the screen says; every renderer walks it. */
function currentView() {
  return journalView(app.state, app);
}

function renderTopbar(view = currentView()) {
  refs.topbarNow.textContent = view.active?.project.name ?? 'No project selected';
  refs.opCsv.disabled = !view.active;
}

function renderRail(view = currentView()) {
  refs.railCount.textContent = pad(view.rail.total);
  refs.railSearch.hidden = view.rail.total === 0;
  refs.rail.classList.toggle('open', app.railOpen);
  refs.scrim.hidden = !app.railOpen;

  const list = refs.railList;
  list.replaceChildren();

  if (view.rail.empty) {
    list.append(h('div', { class: 'rail-none' },
      h('p', {}, view.rail.empty === 'no-match' ? 'No match.' : 'No projects yet.'),
      view.rail.empty === 'no-projects'
        ? h('button', { type: 'button', class: 'mono', onclick: () => openProject() }, 'New project')
        : null,
    ));
    return;
  }

  for (const row of view.rail.rows) {
    list.append(h('button', {
      type: 'button',
      class: 'p-row',
      'aria-current': String(row.current),
      onclick: () => { app.activeProjectId = row.id; setRailOpen(false); renderShell(); },
    },
      h('span', { class: 'p-copy' }, h('strong', {}, row.name)),
      h('span', { class: 'p-count' }, `${pad(row.count)} ${row.count === 1 ? 'entry' : 'entries'}`),
    ));
  }
}

function renderWork(view = currentView()) {
  const root = refs.work;
  root.replaceChildren();

  if (!view.active) {
    root.append(h('div', { class: 'work-inner' },
      h('div', { class: 'empty-work' },
        h('span', { class: 'empty-frame', 'aria-hidden': 'true' }),
        h('p', { class: 'mono' }, 'Accomplishment Journal / Private by design'),
        h('h1', {}, 'Make your work memorable.'),
        h('span', {}, 'Create a project for a role, client, or body of work—then record what you accomplished.'),
        h('button', { type: 'button', class: 'act', onclick: () => openProject() }, 'New project'),
      ),
    ));
    return;
  }

  const { project, entryCount, groups } = view.active;
  const inner = h('div', { class: 'work-inner' });

  inner.append(h('div', { class: 'p-meta mono' },
    h('span', {}, 'Project'),
    h('span', {}, `Since ${view.active.startedStamp}`),
    h('span', {}, `Updated ${view.active.updatedStamp}`),
  ));

  inner.append(h('div', { class: 'p-head' },
    h('div', {},
      h('h1', {}, project.name),
      project.description ? h('p', { class: 'p-desc' }, project.description) : null,
    ),
    h('div', { class: 'p-ops mono' },
      h('button', { type: 'button', onclick: () => openProject(project) }, 'Edit'),
      h('button', { type: 'button', class: 'danger', onclick: () => deleteProject(project) }, 'Delete'),
    ),
  ));

  if (project.tags.length > 0) {
    inner.append(h('div', { class: 'p-tags' }, ...project.tags.map((tag) => h('span', {}, tag))));
  }

  inner.append(h('div', { class: 'log-head' },
    h('div', {},
      h('p', { class: 'log-title mono' }, 'Accomplishment log'),
      h('p', { class: 'log-sub mono' },
        `${pad(entryCount)} ${entryCount === 1 ? 'entry' : 'entries'} · by ${app.grouping}`),
    ),
    h('div', { class: 'log-ops' },
      h('fieldset', { class: 'seg mono' },
        h('legend', { class: 'sr-only' }, 'Group entries by'),
        h('button', {
          type: 'button', 'aria-pressed': String(app.grouping === 'date'),
          onclick: () => { app.grouping = 'date'; renderWork(); },
        }, 'Date'),
        h('button', {
          type: 'button', 'aria-pressed': String(app.grouping === 'milestone'),
          onclick: () => { app.grouping = 'milestone'; renderWork(); },
        }, 'Milestone'),
      ),
      h('button', { type: 'button', class: 'act', onclick: () => openEntry() }, 'New entry'),
    ),
  ));

  if (entryCount > 0) {
    for (const group of groups) {
      const section = h('section', {},
        h('div', { class: 'group-line mono' },
          h('span', {}, group.label),
          h('i', { 'aria-hidden': 'true' }),
          h('b', {}, pad(group.count)),
        ),
      );

      for (const row of group.rows) {
        const { entry } = row;
        section.append(h('article', { class: 'entry' },
          h('div', { class: 'entry-side mono' },
            h('b', {}, pad(row.sequence)),
            h('span', {}, row.aside),
          ),
          h('div', {},
            h('div', { class: 'entry-top' },
              h('h3', {}, entry.title),
              h('div', { class: 'entry-ops mono' },
                h('button', {
                  type: 'button', disabled: !row.canMoveUp,
                  'aria-label': `Move ${entry.title} up`,
                  onclick: () => reorderEntry(entry, -1),
                }, '↑'),
                h('button', {
                  type: 'button', disabled: !row.canMoveDown,
                  'aria-label': `Move ${entry.title} down`,
                  onclick: () => reorderEntry(entry, 1),
                }, '↓'),
                h('button', { type: 'button', onclick: () => openEntry(entry) }, 'Edit'),
                h('button', { type: 'button', class: 'danger', onclick: () => deleteEntry(entry) }, 'Del'),
              ),
            ),
            renderMarkdown(entry.markdown),
          ),
        ));
      }
      inner.append(section);
    }
  } else {
    inner.append(h('div', { class: 'empty-log' },
      h('p', { class: 'mono' }, 'Your record starts here'),
      h('h2', {}, 'What did you accomplish?'),
      h('p', { class: 'note' }, 'Capture a result, decision, contribution, or milestone while the details are still fresh.'),
      h('button', { type: 'button', class: 'act', onclick: () => openEntry(undefined, true) }, 'Write an entry'),
    ));
  }

  root.append(inner);
}

let noticeTimer = 0;

/**
 * Show a message in the notice area.
 *
 * `options.action` adds a button ({ label, run }); `options.sticky` keeps the
 * notice up until it is replaced or dismissed — used for the states the user
 * has to act on, like an unreadable journal.
 */
function setNotice(text, options = {}) {
  window.clearTimeout(noticeTimer);
  if (!text) { refs.notice.hidden = true; return; }
  refs.noticeText.textContent = text;

  const action = options.action ?? null;
  refs.noticeAction.hidden = !action;
  refs.noticeAction.textContent = action?.label ?? '';
  refs.noticeAction.onclick = action?.run ?? null;

  refs.notice.hidden = false;
  if (!options.sticky) noticeTimer = window.setTimeout(() => { refs.notice.hidden = true; }, 4200);
}

function renderShell() {
  const view = currentView();
  renderTopbar(view);
  renderRail(view);
  renderWork(view);
  /* Lock page scroll while a modal is up (same as the original app). */
  document.body.style.overflow = app.entryOpen || app.projectOpen ? 'hidden' : '';
}

/* ------------------------------------------------------------- persistence */

/**
 * Refuse to overwrite unreadable browser data and offer a recoverable reset.
 */
function reportUnreadable(reason) {
  app.locked = true;
  setNotice(reason ?? 'Your saved journal could not be read.', {
    sticky: true,
    action: { label: 'Move it aside', run: quarantineJournal },
  });
}

/** Move the unreadable journal aside so writing can resume. */
async function quarantineJournal() {
  const prompt = HOSTED_ON_PAGES
    ? 'Move the unreadable browser data aside and start a new journal? A recovery copy will stay in this browser.'
    : 'Move the unreadable journal file aside and start a new one? The old file is renamed, not deleted.';
  if (!window.confirm(prompt)) return;
  try {
    let payload;
    if (HOSTED_ON_PAGES) {
      payload = { state: quarantineLocalJournal() };
    } else {
      const response = await fetch('/api/journal/quarantine', { method: 'POST' });
      payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? 'The journal could not be moved aside.');
    }
    app.locked = false;
    adopt(payload);
    app.activeProjectId = '';
    renderShell();
    setNotice(HOSTED_ON_PAGES
      ? 'A recovery copy was kept in this browser. A new journal is ready.'
      : (payload.movedTo ? `Saved as ${payload.movedTo}. A new journal is ready.` : 'A new journal is ready.'));
  } catch (error) {
    setNotice(error instanceof Error ? error.message : 'The journal could not be moved aside.', { sticky: true });
  }
}

/**
 * Apply one operation and save the updated journal in this browser.
 *
 * Returns the response payload, or `null` if nothing was changed — callers use
 * that to leave a dialog open with the user's text still in it.
 */
async function sendOp(operation) {
  if (app.locked) {
    setNotice('Nothing is being saved while this browser\'s journal is unreadable.', {
      sticky: true,
      action: { label: 'Move it aside', run: quarantineJournal },
    });
    return null;
  }
  try {
    let payload;
    if (HOSTED_ON_PAGES) {
      const applied = applyOperation(app.state, operation);
      saveJournal(applied.state);
      payload = { state: applied.state, createdId: applied.createdId };
    } else {
      const response = await fetch('/api/op', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(operation),
      });
      payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (payload.code === 'journal-unreadable') reportUnreadable(payload.reason);
        else setNotice(payload.error ?? 'Could not save to the local journal.');
        return null;
      }
    }
    adopt(payload);
    return payload;
  } catch (error) {
    setNotice(error instanceof Error ? error.message : 'Could not save in this browser.');
    return null;
  }
}

/* -------------------------------------------------------------- project UI */

function openProject(project = null) {
  app.editingProject = project;
  projectForm.name = project?.name ?? '';
  projectForm.description = project?.description ?? '';
  projectForm.startedOn = project?.startedOn ?? toLocalDateInput();
  projectForm.tags = project?.tags.join(', ') ?? '';

  refs.pfName.value = projectForm.name;
  refs.pfDesc.value = projectForm.description;
  refs.pfStart.value = projectForm.startedOn;
  refs.pfTags.value = projectForm.tags;
  refs.sheetTitle.textContent = project ? 'Edit project' : 'New project';
  refs.pfSubmit.textContent = project ? 'Save project' : 'Create project';
  refs.sheet.setAttribute('aria-label', project ? 'Edit project' : 'New project');

  app.projectOpen = true;
  setRailOpen(false);
  renderShell();
  refs.sheet.showModal();
}

function closeProjectSheet() {
  app.projectOpen = false;
  if (refs.sheet.open) refs.sheet.close();
  renderShell();
}

async function saveProject(event) {
  event.preventDefault();
  const editing = app.editingProject;
  const fields = {
    name: projectForm.name,
    description: projectForm.description,
    startedOn: projectForm.startedOn,
    /* Splitting the text field is form parsing; trimming and de-duplicating
       the tags themselves is the server's job. */
    tags: projectForm.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
  };
  const result = editing
    ? await sendOp({ op: 'update_project', id: editing.id, ...fields })
    : await sendOp({ op: 'create_project', ...fields });
  /* Nothing was saved — leave the sheet open with what the user typed. */
  if (!result) return;
  if (!editing) app.activeProjectId = result.createdId;
  closeProjectSheet();
  setNotice(editing ? 'Project updated.' : 'Project created.');
}

async function deleteProject(project) {
  const count = app.state.achievements.filter((entry) => entry.projectId === project.id).length;
  const tail = count ? ` and ${count} log entr${count === 1 ? 'y' : 'ies'}` : '';
  if (!window.confirm(`Delete ${project.name}${tail}? This cannot be undone.`)) return;
  if (!await sendOp({ op: 'delete_project', id: project.id })) return;
  if (app.activeProjectId === project.id) {
    app.activeProjectId = app.state.projects[0]?.id ?? '';
  }
  setNotice('Project deleted.');
  renderShell();
}

/* --------------------------------------------------------------- entry UI */

function openEntry(entry = undefined, focus = false) {
  if (!entry && !app.activeProjectId) { openProject(); return; }
  app.editingEntry = entry ?? null;
  entryForm.projectId = entry?.projectId ?? app.activeProjectId;
  entryForm.title = entry?.title ?? '';
  entryForm.date = entry?.date ?? toLocalDateInput();
  entryForm.milestone = entry?.milestone ?? '';
  entryForm.markdown = entry?.markdown ?? '';

  /* Populate the project select from the current state (the dialog is modal,
     so it cannot go stale while open). */
  refs.efProject.replaceChildren(
    h('option', { value: '' }, 'Choose project'),
    ...app.state.projects.map((project) => h('option', { value: project.id }, project.name)),
  );
  refs.efProject.value = entryForm.projectId;
  refs.efTitle.value = entryForm.title;
  refs.efDate.value = entryForm.date;
  refs.efMilestone.value = entryForm.milestone;
  refs.efMarkdown.value = entryForm.markdown;

  app.focusMode = focus;
  app.entryOpen = true;
  setRailOpen(false);
  applyWriterChrome();
  updatePreview();
  renderShell();
  /* Grow only after `showModal`: while the dialog is closed its
     `scrollHeight` is 0, which would squash the textarea. */
  refs.writer.showModal();
  growLogField();
  if (!entry) refs.efTitle.focus();
}

function closeEntry() {
  app.entryOpen = false;
  app.focusMode = false;
  if (refs.writer.open) refs.writer.close();
  renderShell();
}

/** Reflect focus/preview mode into the stable writer chrome. */
function applyWriterChrome() {
  refs.writer.className = `writer ${app.focusMode ? 'focused' : ''}`;
  refs.writer.setAttribute('aria-label', app.editingEntry ? 'Edit entry' : 'New entry');
  refs.writerTitle.textContent = app.editingEntry ? 'Edit entry' : 'New entry';
  refs.btnPreview.setAttribute('aria-pressed', String(app.preview));
  refs.btnPreview.disabled = app.focusMode;
  refs.btnFocus.setAttribute('aria-pressed', String(app.focusMode));
  refs.btnRecord.textContent = app.editingEntry ? 'Save' : 'Record';
  refs.writerMeta.hidden = app.focusMode;
  const split = app.preview && !app.focusMode;
  refs.writerGrid.classList.toggle('split', split);
  refs.writerPreview.hidden = !split;
}

function updatePreview() {
  const body = refs.previewBody;
  body.replaceChildren();
  if (entryForm.markdown.trim()) body.append(renderMarkdown(entryForm.markdown));
  else body.append(h('p', { class: 'preview-empty' }, 'Rendered output appears as you write.'));
}

/** The log field grows with its content — one scroll context while writing. */
function growLogField() {
  const field = refs.efMarkdown;
  field.style.height = 'auto';
  field.style.height = `${field.scrollHeight}px`;
}

async function saveEntry(event) {
  event.preventDefault();
  const wasEditing = app.editingEntry;
  const fields = {
    projectId: entryForm.projectId,
    title: entryForm.title,
    date: entryForm.date,
    milestone: entryForm.milestone,
    markdown: entryForm.markdown,
  };
  const result = wasEditing
    ? await sendOp({ op: 'update_entry', id: wasEditing.id, ...fields })
    : await sendOp({ op: 'record_entry', ...fields });
  /* Nothing was saved — leave the writer open with what the user wrote. */
  if (!result) return;
  app.activeProjectId = entryForm.projectId;
  closeEntry();
  setNotice(wasEditing ? 'Entry updated.' : 'Entry recorded.');
}

async function deleteEntry(entry) {
  if (!window.confirm(`Delete "${entry.title}"? This cannot be undone.`)) return;
  if (!await sendOp({ op: 'delete_entry', id: entry.id })) return;
  setNotice('Entry deleted.');
  renderShell();
}

async function reorderEntry(entry, direction) {
  if (!await sendOp({ op: 'move_entry', id: entry.id, direction })) return;
  renderWork();
}

/* ------------------------------------------------------------ data actions */

async function exportBackup() {
  try {
    if (HOSTED_ON_PAGES) {
      downloadFile(`accomplishment-journal-backup-${toLocalDateInput()}.json`, backupBlob(app.state));
    } else {
      const response = await fetch('/api/export/backup');
      if (!response.ok) throw new Error('The local server could not build a backup.');
      downloadFile(`accomplishment-journal-backup-${toLocalDateInput()}.json`, await response.blob());
    }
    setNotice('Full JSON backup downloaded.');
  } catch {
    setNotice('Backup failed.');
  }
}

async function exportCsv() {
  const { active } = currentView();
  if (!active) { setNotice('Choose a project before exporting its entries.'); return; }
  try {
    let csv;
    if (HOSTED_ON_PAGES) {
      csv = projectCsv(app.state, active.project.id);
    } else {
      const response = await fetch(`/api/export/csv?project=${encodeURIComponent(active.project.id)}`);
      if (!response.ok) throw new Error('The local server could not build the CSV.');
      csv = { name: 'accomplishment-log.csv', blob: await response.blob() };
    }
    const { entryCount } = active;
    downloadFile(csv.name, csv.blob);
    setNotice(`CSV downloaded with ${entryCount} log entr${entryCount === 1 ? 'y' : 'ies'}.`);
  } catch {
    setNotice('CSV export failed.');
  }
}

async function importBackup(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const state = HOSTED_ON_PAGES ? normalizeBackup(parsed) : null;
    if (!window.confirm('Replace the current journal with this backup? Export a backup first if you want to keep the current records.')) return;
    let payload;
    if (HOSTED_ON_PAGES) {
      saveJournal(state);
      payload = { state };
    } else {
      const response = await fetch('/api/import/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: text,
      });
      payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? 'The file could not be read.');
    }
    adopt(payload);
    app.activeProjectId = app.state.projects[0]?.id ?? '';
    setNotice('Backup imported successfully.');
    renderShell();
  } catch (error) {
    setNotice(`Import failed: ${error instanceof Error ? error.message : 'The file could not be read.'}`);
  }
}

/* --------------------------------------------------------------- rail/tabs */

function setRailOpen(open) {
  app.railOpen = open;
  renderRail();
}

/* ------------------------------------------------------------------ boot */

async function hydrate() {
  try {
    if (HOSTED_ON_PAGES) {
      adopt({ state: loadJournal() });
    } else {
      const response = await fetch('/api/state');
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 409) reportUnreadable(payload.reason);
        else throw new Error('The local server did not answer.');
      } else {
        adopt(payload);
      }
    }
  } catch (error) {
    adopt({ state: EMPTY_JOURNAL });
    reportUnreadable(error instanceof Error ? error.message : 'Saved records could not be opened.');
  }
  const { projects } = app.state;
  app.activeProjectId = projects[0]?.id ?? '';
  app.hydrated = true;
  renderShell();
}

function bindEvents() {
  refs.topbarOpen.addEventListener('click', () => setRailOpen(true));
  refs.scrim.addEventListener('click', () => setRailOpen(false));
  refs.railNew.addEventListener('click', () => openProject());
  refs.search.addEventListener('input', (event) => { app.query = event.target.value; renderRail(); });

  refs.opBackup.addEventListener('click', exportBackup);
  refs.opRestore.addEventListener('click', () => refs.importInput.click());
  refs.opCsv.addEventListener('click', exportCsv);
  refs.importInput.addEventListener('change', importBackup);
  refs.noticeClose.addEventListener('click', () => setNotice(''));

  /* Project sheet */
  refs.sheetClose.addEventListener('click', closeProjectSheet);
  refs.pfCancel.addEventListener('click', closeProjectSheet);
  refs.projectForm.addEventListener('submit', saveProject);
  /* Click-to-dismiss on the backdrop (same as the original app). */
  refs.sheet.addEventListener('click', (event) => { if (event.target === refs.sheet) closeProjectSheet(); });
  /* The native Escape path; the global keydown below covers the rest. Both are idempotent. */
  refs.sheet.addEventListener('cancel', (event) => { event.preventDefault(); closeProjectSheet(); });

  refs.pfName.addEventListener('input', (event) => { projectForm.name = event.target.value; });
  refs.pfDesc.addEventListener('input', (event) => { projectForm.description = event.target.value; });
  refs.pfStart.addEventListener('input', (event) => { projectForm.startedOn = event.target.value; });
  refs.pfTags.addEventListener('input', (event) => { projectForm.tags = event.target.value; });

  /* Writer */
  refs.writerClose.addEventListener('click', closeEntry);
  refs.entryForm.addEventListener('submit', saveEntry);
  refs.writer.addEventListener('cancel', (event) => { event.preventDefault(); closeEntry(); });

  refs.btnPreview.addEventListener('click', () => {
    if (app.focusMode) return;
    app.preview = !app.preview;
    applyWriterChrome();
    updatePreview();
    growLogField();
  });
  refs.btnFocus.addEventListener('click', () => {
    app.focusMode = !app.focusMode;
    applyWriterChrome();
    growLogField();
    if (app.focusMode) refs.efMarkdown.focus();
  });

  refs.efProject.addEventListener('change', (event) => { entryForm.projectId = event.target.value; });
  refs.efTitle.addEventListener('input', (event) => { entryForm.title = event.target.value; });
  refs.efDate.addEventListener('input', (event) => { entryForm.date = event.target.value; });
  refs.efMilestone.addEventListener('input', (event) => { entryForm.milestone = event.target.value; });
  refs.efMarkdown.addEventListener('input', (event) => {
    entryForm.markdown = event.target.value;
    updatePreview();
    growLogField();
  });

  /* Keyboard: N entry · P project · / find · Ctrl/Cmd+Enter save · Esc close. */
  window.addEventListener('keydown', (event) => {
    const target = event.target;
    const typing = !!target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName));

    if (event.key === 'Escape') {
      if (app.entryOpen) closeEntry();
      else if (app.projectOpen) closeProjectSheet();
      else if (app.railOpen) setRailOpen(false);
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && app.entryOpen) {
      event.preventDefault();
      refs.entryForm.requestSubmit();
      return;
    }
    if (typing || event.metaKey || event.ctrlKey || event.altKey || app.entryOpen || app.projectOpen) return;

    if (event.key === 'n') { event.preventDefault(); openEntry(); }
    else if (event.key === 'p') { event.preventDefault(); openProject(); }
    else if (event.key === '/') { event.preventDefault(); refs.search.focus(); }
  });
}

function init() {
  refs.topbarOpen = $('#topbar-open');
  refs.topbarNow = $('#topbar-now');
  refs.scrim = $('#scrim');
  refs.rail = $('#rail');
  refs.railCount = $('#rail-count');
  refs.railNew = $('#rail-new');
  refs.railSearch = $('#rail-search');
  refs.railList = $('#rail-list');
  refs.search = $('#search');
  refs.opBackup = $('#op-backup');
  refs.opRestore = $('#op-restore');
  refs.opCsv = $('#op-csv');
  refs.importInput = $('#import');
  refs.work = $('#work');
  refs.notice = $('#notice');
  refs.noticeText = $('#notice-text');
  refs.noticeAction = $('#notice-action');
  refs.noticeClose = $('#notice-close');

  refs.sheet = $('#sheet');
  refs.sheetTitle = $('#sheet-title');
  refs.sheetClose = $('#sheet-close');
  refs.projectForm = $('#project-form');
  refs.pfName = $('#pf-name');
  refs.pfDesc = $('#pf-desc');
  refs.pfStart = $('#pf-start');
  refs.pfTags = $('#pf-tags');
  refs.pfCancel = $('#pf-cancel');
  refs.pfSubmit = $('#pf-submit');

  refs.writer = $('#writer');
  refs.writerTitle = $('#writer-title');
  refs.writerClose = $('#writer-close');
  refs.entryForm = $('#entry-form');
  refs.btnPreview = $('#btn-preview');
  refs.btnFocus = $('#btn-focus');
  refs.btnRecord = $('#btn-record');
  refs.writerMeta = $('#writer-meta');
  refs.writerGrid = $('#writer-grid');
  refs.writerPreview = $('#writer-preview');
  refs.previewBody = $('#preview-body');
  refs.efProject = $('#ef-project');
  refs.efTitle = $('#ef-title');
  refs.efDate = $('#ef-date');
  refs.efMilestone = $('#ef-milestone');
  refs.efMarkdown = $('#ef-markdown');

  bindEvents();
  hydrate();
}

document.addEventListener('DOMContentLoaded', init);
