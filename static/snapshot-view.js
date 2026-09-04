/* Accomplishment Journal — what the share page says about a snapshot.
 *
 * A sibling of `activeView` in view.js: both wrap the same `logRows` /
 * `groupLogRows` mechanism, imported rather than reimplemented, so the
 * numbering and grouping rules cannot drift between the two pages. What
 * differs is only what each wraps around it. There is no `updatedStamp`,
 * because a snapshot does not carry `updatedAt` and a recruiter has no
 * business reading the owner's editing habits, and there are no move
 * affordances, because nothing on this read-only page can move — so this
 * file never adds the `canMoveUp`/`canMoveDown` fields `activeView` layers
 * on top of the same rows.
 *
 * Nothing in this file touches the document. See tests/snapshot-view.test.js.
 */

import { formatStamp, logRows, groupLogRows } from './view.js';

/** The share page, described once. The renderer is a dumb walk over this. */
export function snapshotView(snapshot) {
  const { entries, grouping } = snapshot;

  return {
    who: snapshot.who,
    project: snapshot.project,
    startedStamp: formatStamp(snapshot.project.startedOn),
    entryCount: entries.length,
    groups: groupLogRows(logRows(entries, grouping), grouping),
  };
}
