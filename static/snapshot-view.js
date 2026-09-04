/* Accomplishment Journal — what the share page says about a snapshot.
 *
 * A sibling of `activeView` in view.js rather than a reuse of it. The two
 * differ in exactly the ways a shared log differs from an owned one: there is
 * no `updatedStamp`, because a snapshot does not carry `updatedAt` and a
 * recruiter has no business reading the owner's editing habits, and there are
 * no move affordances, because nothing on that page can move.
 *
 * Nothing in this file touches the document. See tests/snapshot-view.test.js.
 */

import { formatStamp } from './view.js';

/** The share page, described once. The renderer is a dumb walk over this. */
export function snapshotView(snapshot) {
  const { entries, grouping } = snapshot;

  const rows = entries.map((entry, position) => ({
    entry,
    /* Ascending log number, so the first record ever written stays 01 —
       the same rule the app uses, so a snapshot reads like its journal. */
    sequence: entries.length - position,
    /* The side column shows whichever of milestone and date the log is not
       already grouped by. */
    aside: grouping === 'date' ? (entry.milestone || '—') : formatStamp(entry.date),
  }));

  const buckets = new Map();
  for (const row of rows) {
    const key = grouping === 'date' ? row.entry.date : (row.entry.milestone || 'Unassigned');
    buckets.set(key, [...(buckets.get(key) ?? []), row]);
  }

  return {
    who: snapshot.who,
    project: snapshot.project,
    startedStamp: formatStamp(snapshot.project.startedOn),
    entryCount: entries.length,
    groups: [...buckets].map(([key, groupRows]) => ({
      key,
      label: grouping === 'date' ? formatStamp(key) : key,
      count: groupRows.length,
      rows: groupRows,
    })),
  };
}
