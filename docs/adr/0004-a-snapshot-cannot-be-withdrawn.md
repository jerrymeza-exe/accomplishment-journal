# A snapshot cannot be withdrawn

A snapshot is a bearer link: whoever holds it can read it, permanently. There
is no expiry, no revocation and no access log, and adding any of them would
mean a server the journal deliberately does not have.

Two things follow, and both are commitments rather than preferences.

**Every payload version stays readable forever.** A backup can be re-exported
when the format moves on; a snapshot cannot, because the copy that matters is
in somebody else's inbox. `readSnapshot` therefore dispatches through a map of
version to reader, and a new format adds a reader without touching the old
ones. A payload from a version this build does not know is refused by name —
never rendered with whichever fields happen to line up.

**A snapshot that cannot be read in full is refused.** This is ADR-0001's rule
in a second place: an unreadable journal is not an empty one, and an
incomplete snapshot is not a short career. A partially rendered page tells a
recruiter something false about the person who sent it, and neither of them
finds out. `readSnapshot` validates every field and answers with a named
reason, so the page can say which of the four failures happened.

## Consequences

- Every payload version this journal has published stays readable; `READERS`
  in `static/snapshot.js` only ever gains entries.
- A snapshot that cannot be read in full is refused by name, never partially
  rendered.
- A link that has been sent cannot be recalled, so the preview is the only
  moment its contents can be checked.
- The journal keeps no record of which snapshots were made or when.

## What this decision is not

It is not a duplication of a journal rule, and ADR-0002 still holds. Encoding
a snapshot lives only in `static/snapshot.js`, and `app.py` has no encoder:
a snapshot cannot alter a journal, so it is presentation in the same sense
that rendering Markdown is. The local build's browser already holds the
journal it fetched from `/api/state` and encodes the snapshot there.
