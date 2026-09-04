/* Accomplishment Journal — snapshots.
 *
 * A snapshot is a frozen, self-contained copy of one project's accomplishment
 * log, encoded into a link. It cannot be changed or withdrawn once sent.
 *
 * Three steps with seams between them:
 *
 *   snapshotFrom(state, projectId, options) -> Snapshot    plain data
 *   encodeSnapshot(snapshot)  -> Promise<string>           data to payload
 *   readSnapshot(fragment)    -> Promise<Result>           payload to data
 *
 * Encoding lives here and only here. A snapshot cannot alter a journal, so
 * under ADR-0002 it is presentation rather than a journal rule: both builds
 * run this file in the browser, and app.py has no encoder of its own.
 */

export const SNAPSHOT_VERSION = 1;

/* Above this a link still works in every browser, but some mail clients wrap
   or truncate it in transit — and a broken link fails silently at the far end,
   where nobody will report it. Measured at roughly ten entries of prose. */
export const SAFE_URL_LENGTH = 2000;

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * A frozen copy of one project's log, ready to encode.
 *
 * The shape is deliberately not the journal's. Ids, `createdAt`, `updatedAt`
 * and `tags` are dropped rather than filtered later: what a snapshot omits is
 * the only privacy control it has, so omission happens once, here.
 */
export function snapshotFrom(state, projectId, options = {}) {
  const project = state.projects.find((candidate) => candidate.id === projectId);
  if (!project) throw new Error('That project is no longer in this journal.');

  const entries = state.achievements.filter((entry) => entry.projectId === project.id);
  if (!entries.length) throw new Error('A project with no entries has nothing to share.');

  return {
    version: SNAPSHOT_VERSION,
    who: cleanText(options.who),
    grouping: options.grouping === 'milestone' ? 'milestone' : 'date',
    project: {
      name: project.name,
      description: project.description,
      startedOn: project.startedOn,
    },
    entries: entries.map((entry) => ({
      title: entry.title,
      date: entry.date,
      milestone: entry.milestone,
      markdown: entry.markdown,
    })),
  };
}
