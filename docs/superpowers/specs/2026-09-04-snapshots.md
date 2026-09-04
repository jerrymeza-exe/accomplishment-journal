# Snapshots — Design Spec

**Status:** agreed 2026-09-04
**Feature:** share one project's accomplishment log with one person, by link.

## The concept

A **snapshot** is a frozen, self-contained copy of one project's accomplishment
log, encoded into a link. It cannot be changed or withdrawn once sent.

"Share" is the verb; "snapshot" is the noun. The permanence lives in the
vocabulary rather than in a warning nobody reads.

## Who this is for

One named recipient — a recruiter — that the journal's owner hands the link to
directly. Not public posting, not search-indexed. The threat model is "a leaked
link is embarrassing, not catastrophic."

## Decisions

| # | Decision | Chosen |
|---|---|---|
| 1 | Audience | One named recruiter, handed the link directly |
| 2 | Privacy contract | Bearer link, permanent, no revocation or expiry |
| 3 | Scope of one share | One project |
| 4 | Which builds | Both; Pages first |
| 5 | Snapshot or live | Frozen snapshot |
| 6 | Recipient's page | Dedicated read-only page, not the app in read-only mode |
| 7 | Framing | Project + the owner's name. No per-share note |
| 8 | Consent gate | A preview is the only route to a link |
| 9 | Mechanism | URL fragment, self-contained |
| 10 | Control placement | Beside CSV in `rail-ops` |
| 11 | Rule duplication | None — see #27 |
| 12 | Fields shared | Purpose-built shape; IDs, timestamps and tags dropped |
| 13 | Encoding | JSON -> raw deflate -> base64url |
| 14 | Size policy | Warn above ~2,000 chars, always allow |
| 15 | Undecodable fragment | Refuse explicitly; never render partially |
| 16 | Versioning | Payload carries a version; every version readable forever |
| 17 | Preview fidelity | The preview *is* the share page, same code path |
| 18 | Fonts | Self-contained; no third-party request from the recipient |
| 19 | Recipient actions | Read + `@media print`. No buttons |
| 20 | Ordering | Grouping chosen at share time; sequence numbers kept |
| 21 | Owner's name | Stored outside the journal; format stays v3 |
| 22 | Local record of shares | None in v1 |
| 23 | Pages URL for the local build | `--share-base` flag, defaulting to one derived from `origin` |
| 24 | Content-spoofing surface | Accepted, plus a footer label |
| 25 | Vocabulary | "Snapshot" |
| 26 | Sequencing | Stage 1 Pages end-to-end; stage 2 Python |
| 27 | Python encoder | None — the browser encodes in both builds |
| 28 | Empty project | Share is disabled when a project has no entries |

## Why there is no Python encoder (#27)

`static/app.js:26` branches on `HOSTED_ON_PAGES`, and every capability today
exists twice: `projectCsv` in JS and `/api/export/csv` in Python. A snapshot
does not need that. In the local build the browser has already fetched the
journal from `/api/state`, so it can call the same encoder the hosted build
calls.

ADR-0002 draws its line at *journal integrity* versus *presentation*. A
snapshot produces a link and cannot alter a journal, so it is presentation —
the same category as rendering Markdown, which already lives only in JS.
Mirroring it into Python would mean writing an ADR to excuse a duplication the
architecture does not require.

## The share shape

Deliberately not the journal shape. Internal IDs, every `createdAt` and
`updatedAt`, and `tags` do not cross the boundary: tags are the owner's
findability labels, and the timestamps describe editing habits rather than
work.

```json
{
  "version": 1,
  "who": "Gerardo Meza Jr.",
  "grouping": "date",
  "project": { "name": "...", "description": "...", "startedOn": "2026-01-05" },
  "entries": [
    { "title": "...", "date": "2026-03-04", "milestone": "...", "markdown": "..." }
  ]
}
```

## The link

```
https://<owner>.github.io/accomplishment-journal/share.html#<payload>
```

`payload` is that JSON, UTF-8 encoded, raw-deflated, then base64url with
padding stripped. Fragments are never transmitted to a server — not in the
HTTP request, not in `Referer` — so GitHub never receives journal entries and
nothing is committed per snapshot.

Measured payload sizes, ordinary prose:

| Entries | Raw JSON | Deflated | Final URL |
|---|---|---|---|
| 10 | 7 KB | 1.4 KB | ~2,000 chars |
| 20 | 18 KB | 2.9 KB | ~4,000 chars |
| 50 | 44 KB | 6.2 KB | ~8,500 chars |
| 100 | 89 KB | 11.6 KB | ~15,900 chars |

Browsers are not the constraint. Mail clients are: ~2,000 characters is the
safe-everywhere zone, and plain-text line wrapping is what breaks a long URL.

## Refusal states

The share page renders a snapshot or it refuses. It never renders part of one.
A blank or partial render tells a recruiter the owner has no accomplishments —
ADR-0001's bug with a worse consequence.

| Reason | Cause |
|---|---|
| `no-link` | The page was opened without a fragment |
| `unreadable` | Truncated or corrupt payload — usually a mail client wrapping the URL |
| `unsupported-version` | Made by a newer build |
| `unsupported-browser` | No `DecompressionStream` (pre-2023 browser) |

Every version ever written stays readable. That is the price of a link that
cannot be re-sent, and it is recorded in ADR-0004.

## Accepted trade-offs

Stated here so they are chosen rather than discovered.

- The link is a bearer token. No expiry, no revocation, no access log.
- The share page renders arbitrary content from anyone's fragment. It is safe
  against script injection — `markdown.js` allowlists URL schemes and builds
  DOM nodes rather than assigning `innerHTML` — but not against content
  spoofing on a domain carrying the owner's name.
- The owner gets no record of what was sent or when.

## Out of scope for v1

Deferred deliberately, not forgotten: a downloadable self-contained HTML file
for oversized projects; a local log of snapshots created; sharing several
projects at once; per-entry selection.
