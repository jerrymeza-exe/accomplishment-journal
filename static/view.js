/* Accomplishment Journal — what the screen says about a journal.
 *
 * `journalView(state, ui) -> ViewModel` answers that once. The
 * renderers in app.js became dumb walks over the result, so the rail and the
 * work area can no longer disagree about a count, and every derivation here —
 * grouping, sequence numbers, which arrows are live — is assertable without a
 * DOM. See tests/view.test.js.
 *
 * `ui` is the interface's own state: { activeProjectId, query, grouping }.
 * Nothing in this file touches the document.
 */

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * Field-log stamp for the monospace layer: `30 AUG 2026`.
 *
 * Presentation, so it lives on this side of the seam — the server refuses
 * impossible days (tracker.is_calendar_date), so this never has to decide
 * what `2026-13-45` means.
 */
export function formatStamp(value) {
  if (!value) return 'NO DATE';
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return 'NO DATE';
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return 'NO DATE';
  return `${String(date.getDate()).padStart(2, '0')} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** The rail: one row per project the filter admits, each with its entry count. */
function railView(state, ui) {
  const { projects, achievements } = state;
  const term = ui.query.trim().toLowerCase();
  const matches = term
    ? projects.filter((project) =>
        [project.name, project.description, project.tags.join(' ')].join(' ').toLowerCase().includes(term))
    : projects;

  return {
    total: projects.length,
    rows: matches.map((project) => ({
      id: project.id,
      name: project.name,
      count: achievements.filter((entry) => entry.projectId === project.id).length,
      current: project.id === ui.activeProjectId,
    })),
    /* `no-match` is a filter that found nothing; `no-projects` is a journal
       nobody has written yet. They read differently and offer different ways
       out, so the difference belongs here rather than in the renderer. */
    empty: matches.length ? null : (projects.length ? 'no-match' : 'no-projects'),
  };
}

/**
 * Flat log rows: the sequence number and the side column, in stored order.
 *
 * Shared by `activeView` and `snapshotView` (static/snapshot-view.js) — the
 * numbering and grouping-key rules are one mechanism regardless of which page
 * is asking, and which fields a caller layers on top (move affordances, in
 * the app's case) is the only thing that differs between them.
 */
export function logRows(entries, grouping) {
  return entries.map((entry, position) => ({
    entry,
    /* Ascending log number, so the first record ever written stays 01. */
    sequence: entries.length - position,
    /* The side column shows whichever of milestone and date the log is not
       already grouped by. */
    aside: grouping === 'date' ? (entry.milestone || '—') : formatStamp(entry.date),
  }));
}

/** Those rows bucketed for display. */
export function groupLogRows(rows, grouping) {
  const buckets = new Map();
  for (const row of rows) {
    const key = grouping === 'date' ? row.entry.date : (row.entry.milestone || 'Unassigned');
    buckets.set(key, [...(buckets.get(key) ?? []), row]);
  }

  return [...buckets].map(([key, groupRows]) => ({
    key,
    label: grouping === 'date' ? formatStamp(key) : key,
    count: groupRows.length,
    rows: groupRows,
  }));
}

/** The work area: the active project's log, grouped and numbered. */
function activeView(state, ui, project) {
  const entries = state.achievements.filter((entry) => entry.projectId === project.id);

  const rows = logRows(entries, ui.grouping).map((row, position) => ({
    ...row,
    canMoveUp: position > 0,
    canMoveDown: position < entries.length - 1,
  }));

  return {
    project,
    startedStamp: formatStamp(project.startedOn),
    updatedStamp: formatStamp(project.updatedAt.slice(0, 10)),
    entryCount: entries.length,
    groups: groupLogRows(rows, ui.grouping),
  };
}

/** The whole screen, described once. `active` is null when no project is open. */
export function journalView(state, ui) {
  const project = state.projects.find((candidate) => candidate.id === ui.activeProjectId) ?? null;
  return {
    rail: railView(state, ui),
    active: project ? activeView(state, ui, project) : null,
  };
}
