# Snapshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the journal's owner send one person a link that opens a frozen, read-only copy of one project's accomplishment log.

**Architecture:** A snapshot is built in the browser, deflated, base64url-encoded, and carried in a URL fragment so no server ever receives it. A dedicated `share.html` decodes the fragment and renders it read-only; none of the app's mutating code is loaded there. Encoding lives only in JavaScript — a snapshot cannot alter a journal, so under ADR-0002 it is presentation, and `app.py` gets no encoder of its own.

**Tech Stack:** Vanilla ES modules, no dependencies. `CompressionStream`/`DecompressionStream` (`deflate-raw`) for the codec. `node --test` for tests. Python 3.10+ standard library for stage 2.

**Spec:** `docs/superpowers/specs/2026-09-04-snapshots.md`

## Global Constraints

- **No dependencies.** Standard library only, on both sides. No npm packages, no CDN scripts.
- **Node is a development tool only.** Running the journal requires Python and its standard library, or nothing at all on Pages.
- **Snapshot format version is `1`.** Every version ever published stays readable forever; `readSnapshot` dispatches through a version map so adding a reader is additive.
- **Safe URL length is 2000 characters.** Above it, warn; never refuse.
- **The share page never renders a partial snapshot.** It renders a complete one or it refuses with a named reason.
- **Fields that must never cross the boundary:** any `id`, any `projectId`, any `createdAt`, any `updatedAt`, and `tags`.
- **No third-party requests from the share page.** No `@import` of Google Fonts, no remote assets. System font stack.
- **The journal format stays at version 3.** Nothing in this feature adds a field to journal state.
- **Comment style:** this codebase explains *why*, not *what*, and names the bug a seam prevents. Match it. Prose comments in `/* */`, sentences with full stops.
- **Commit messages:** imperative mood, no type prefix — match `git log` (e.g. "Publish accomplishment journal with GitHub Pages"). Every commit ends with a trailing line reading `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Decision made during planning, not during design

The spec settles that the share page is self-contained and print-friendly but never says whether it is dark like the app or light like a document. **This plan makes it a light document** that keeps the signal colour and the monospace metadata layer, honours `prefers-color-scheme: dark`, and always prints light. Rationale: the app's near-black ground serves a writer in focus mode; a page a recruiter may print or paste into an ATS is a document. Reverse this in Task 5 if you disagree — it is one stylesheet and touches nothing else.

## File Structure

**Create:**

| File | Responsibility |
|---|---|
| `static/snapshot.js` | What a snapshot *is*: building one from journal state, encoding it, and reading one back. No DOM. |
| `static/snapshot-view.js` | What the share page *says* about a snapshot: grouping, sequence numbers, stamps. No DOM. |
| `static/share.html` | The share page shell. |
| `static/share.js` | The share page's DOM plumbing: read fragment, render or refuse, preview affordances. |
| `static/share.css` | Self-contained styling for the share page, including `@media print`. |
| `tests/snapshot.test.js` | Shape, codec round-trip, and refusal reasons as data. |
| `tests/snapshot-view.test.js` | The share view model as data. |
| `docs/adr/0004-a-snapshot-cannot-be-withdrawn.md` | Why every payload version stays readable forever. |
| `tests/test_app.py` | Stage 2 only: the share base the local server derives. |

**Modify:**

| File | Change |
|---|---|
| `static/index.html` | A `Share` button in `rail-ops`. |
| `static/app.js` | Share handler, owner-name storage, disabled rule, preview launch. |
| `CONTEXT.md` | The `Snapshot` term. |
| `README.md` | A Snapshots section; the HTTP API table gains `/api/config` in stage 2. |
| `app.py` | Stage 2 only: `--share-base`, `GET /api/config`, serving root-level `.html`. |

**Stage boundary:** Tasks 1–9 are stage 1 and ship a working feature on GitHub Pages. Task 10 is stage 2.

## Before Task 1

Local `main` is behind `origin/main` and the working tree holds uncommitted changes to `static/journal.js` and `tests/journal-browser.test.js` that differ from what is already upstream. Reconcile that first — rebase onto `origin/main` and resolve those two files — so no task in this plan is built on a stale base. Confirm with `git status` reporting a clean tree and `node --test` passing before starting.

---

### Task 1: The share shape

Builds the plain-data snapshot from journal state. Pure — no encoding, no DOM.

**Files:**
- Create: `static/snapshot.js`
- Create: `tests/snapshot.test.js`

**Interfaces:**
- Consumes: journal state as `{ version, projects, achievements }` (see `static/journal.js`).
- Produces:
  - `SNAPSHOT_VERSION` — `1`
  - `SAFE_URL_LENGTH` — `2000`
  - `snapshotFrom(state, projectId, options) -> Snapshot`, where `options` is `{ who?: string, grouping?: 'date' | 'milestone' }`. Throws `Error` for an unknown project or a project with no entries.
  - `Snapshot` is `{ version: 1, who: string, grouping: 'date' | 'milestone', project: { name, description, startedOn }, entries: Array<{ title, date, milestone, markdown }> }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/snapshot.test.js`:

```js
/* Tests for snapshots (`static/snapshot.js`).
 *
 * Run from the project root:
 *
 *   node --test
 *
 * A snapshot leaves this machine and cannot be withdrawn, so what it carries
 * is asserted field by field rather than by shape: an id or a timestamp that
 * slips into the payload is a privacy bug, not a cosmetic one.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SNAPSHOT_VERSION, snapshotFrom } from '../static/snapshot.js';

function journal() {
  return {
    version: 3,
    projects: [
      {
        id: 'project-a', name: 'Platform Migration',
        description: 'Consolidating legacy services.', startedOn: '2026-01-05',
        tags: ['needs-writeup', 'old-job'], updatedAt: '2026-04-01T09:00:00.000Z',
      },
      {
        id: 'project-b', name: 'Other', description: '', startedOn: '2026-02-01',
        tags: [], updatedAt: '2026-02-01T09:00:00.000Z',
      },
    ],
    achievements: [
      {
        id: 'entry-2', projectId: 'project-a', title: 'Cut the release cycle',
        date: '2026-03-04', milestone: 'Delivery', markdown: 'Rebuilt the pipeline.',
        createdAt: '2026-03-04T09:00:00.000Z', updatedAt: '2026-03-05T09:00:00.000Z',
      },
      {
        id: 'entry-1', projectId: 'project-a', title: 'Kickoff',
        date: '2026-01-06', milestone: '', markdown: 'Scoped the work.',
        createdAt: '2026-01-06T09:00:00.000Z', updatedAt: '2026-01-06T09:00:00.000Z',
      },
      {
        id: 'entry-3', projectId: 'project-b', title: 'Unrelated',
        date: '2026-02-02', milestone: '', markdown: 'Elsewhere.',
        createdAt: '2026-02-02T09:00:00.000Z', updatedAt: '2026-02-02T09:00:00.000Z',
      },
    ],
  };
}

test('a snapshot carries one project and only its own entries', () => {
  const snapshot = snapshotFrom(journal(), 'project-a', { who: 'Gerardo Meza Jr.' });
  assert.equal(snapshot.version, SNAPSHOT_VERSION);
  assert.equal(snapshot.who, 'Gerardo Meza Jr.');
  assert.equal(snapshot.project.name, 'Platform Migration');
  assert.deepEqual(snapshot.entries.map((entry) => entry.title), ['Cut the release cycle', 'Kickoff']);
});

/* The whole point of a purpose-built shape. A recruiter reading
   `tags: ["needs-writeup", "old-job"]` learns something nobody meant to say,
   and the timestamps describe editing habits rather than work. */
test('a snapshot carries no ids, no timestamps and no tags', () => {
  const snapshot = snapshotFrom(journal(), 'project-a', { who: 'G' });
  const serialized = JSON.stringify(snapshot);
  for (const leak of ['project-a', 'entry-1', 'createdAt', 'updatedAt', 'tags', 'needs-writeup']) {
    assert.equal(serialized.includes(leak), false, `snapshot leaked ${leak}`);
  }
  assert.deepEqual(Object.keys(snapshot.project), ['name', 'description', 'startedOn']);
  assert.deepEqual(Object.keys(snapshot.entries[0]), ['title', 'date', 'milestone', 'markdown']);
});

test('grouping defaults to date and only ever holds a value the view understands', () => {
  assert.equal(snapshotFrom(journal(), 'project-a', {}).grouping, 'date');
  assert.equal(snapshotFrom(journal(), 'project-a', { grouping: 'milestone' }).grouping, 'milestone');
  assert.equal(snapshotFrom(journal(), 'project-a', { grouping: 'nonsense' }).grouping, 'date');
});

test('a missing name is blank rather than absent', () => {
  assert.equal(snapshotFrom(journal(), 'project-a', {}).who, '');
  assert.equal(snapshotFrom(journal(), 'project-a', { who: '  G  ' }).who, 'G');
});

test('an unknown project cannot be snapshotted', () => {
  assert.throws(() => snapshotFrom(journal(), 'project-gone', {}), /no longer in this journal/);
});

/* An empty log renders as a page that reads "this person has no
   accomplishments". The button is disabled for this case (Task 8); this is
   the backstop behind it. */
test('a project with no entries cannot be snapshotted', () => {
  const state = journal();
  state.achievements = state.achievements.filter((entry) => entry.projectId !== 'project-a');
  assert.throws(() => snapshotFrom(state, 'project-a', {}), /no entries/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/snapshot.test.js`

Expected: FAIL — `Cannot find module '../static/snapshot.js'`

- [ ] **Step 3: Write the minimal implementation**

Create `static/snapshot.js`:

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/snapshot.test.js`

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add static/snapshot.js tests/snapshot.test.js && git commit -m "Build a snapshot that carries a log without its bookkeeping" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The codec

Turns a snapshot into a URL-safe payload and back. Verified working on Node 24 and in browsers with `deflate-raw`.

**Files:**
- Modify: `static/snapshot.js` (append)
- Modify: `tests/snapshot.test.js` (append)

**Interfaces:**
- Consumes: `Snapshot` and `snapshotFrom` from Task 1.
- Produces:
  - `encodeSnapshot(snapshot) -> Promise<string>` — base64url, no padding.
  - `decodeSnapshot(payload) -> Promise<unknown>` — rejects on anything that is not a deflate stream holding JSON. Says nothing about whether the JSON is a snapshot; that is Task 3's job.

- [ ] **Step 1: Write the failing tests**

Append to `tests/snapshot.test.js`. Add `decodeSnapshot, encodeSnapshot` to the existing import from `../static/snapshot.js` rather than writing a second import statement:

```js
test('a snapshot survives a round trip through a payload', async () => {
  const snapshot = snapshotFrom(journal(), 'project-a', { who: 'G', grouping: 'milestone' });
  const payload = await encodeSnapshot(snapshot);
  assert.match(payload, /^[A-Za-z0-9_-]+$/, 'payload must be URL-safe with no padding');
  assert.deepEqual(await decodeSnapshot(payload), snapshot);
});

/* Entries are prose, and prose has accents, dashes and the occasional emoji.
   A payload that mangles them corrupts the record silently. */
test('a payload survives characters outside Latin-1', async () => {
  const snapshot = snapshotFrom(journal(), 'project-a', { who: 'Renée' });
  snapshot.entries[0].markdown = 'héllo — 🎉 café · 日本語';
  const restored = await decodeSnapshot(await encodeSnapshot(snapshot));
  assert.equal(restored.entries[0].markdown, 'héllo — 🎉 café · 日本語');
  assert.equal(restored.who, 'Renée');
});

test('compression is doing real work', async () => {
  const snapshot = snapshotFrom(journal(), 'project-a', {});
  snapshot.entries[0].markdown = 'Rebuilt the deploy pipeline end to end. '.repeat(40);
  const raw = JSON.stringify(snapshot).length;
  const payload = await encodeSnapshot(snapshot);
  assert.ok(payload.length < raw / 2, `payload ${payload.length} should be well under half of ${raw}`);
});

test('a payload that is not a payload is rejected', async () => {
  for (const bad of ['', 'not-a-real-payload', 'AAAA']) {
    await assert.rejects(() => decodeSnapshot(bad), `expected ${JSON.stringify(bad)} to be rejected`);
  }
});

/* The mail-client truncation case, which is the one that will actually
   happen. Every prefix has to fail loudly rather than decode to less. */
test('a truncated payload is rejected rather than half-read', async () => {
  const payload = await encodeSnapshot(snapshotFrom(journal(), 'project-a', {}));
  for (const cut of [4, 12, payload.length - 8, payload.length - 1]) {
    await assert.rejects(() => decodeSnapshot(payload.slice(0, cut)), `expected a ${cut}-char prefix to be rejected`);
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/snapshot.test.js`

Expected: FAIL — `encodeSnapshot is not defined`.

- [ ] **Step 3: Write the minimal implementation**

Append to `static/snapshot.js`:

```js
/* ------------------------------------------------------------------ codec */

/* base64 is defined over bytes but `btoa` is defined over a string of char
   codes, so these two conversions are the only place a payload is handled as
   anything but bytes. Reaching for `TextEncoder` here instead would silently
   mangle every character outside Latin-1. */

function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function pipeBytes(bytes, stream) {
  const writer = stream.writable.getWriter();
  /* Both halves of a transform stream reject when the input is bad. Nothing
     awaits the writer, so its rejections are swallowed here and the reader
     below is left to report the failure — otherwise a corrupt payload takes
     the page down with an unhandled rejection instead of showing a refusal. */
  writer.write(bytes).catch(() => {});
  writer.close().catch(() => {});

  const chunks = [];
  const reader = stream.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** A snapshot as a URL-safe payload. Raw deflate: no header, no checksum. */
export async function encodeSnapshot(snapshot) {
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  return toBase64Url(await pipeBytes(bytes, new CompressionStream('deflate-raw')));
}

/** The payload back as data, or a rejection. Says nothing about what it holds. */
export async function decodeSnapshot(payload) {
  const bytes = fromBase64Url(payload);
  const inflated = await pipeBytes(bytes, new DecompressionStream('deflate-raw'));
  return JSON.parse(new TextDecoder().decode(inflated));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/snapshot.test.js`

Expected: PASS, 11 tests. If Node reports an unhandled rejection and exits non-zero rather than a clean pass, the two `.catch(() => {})` calls in `pipeBytes` are missing — this was verified to be the actual behaviour without them.

- [ ] **Step 5: Commit**

```bash
git add static/snapshot.js tests/snapshot.test.js && git commit -m "Carry a snapshot in a link instead of on a server" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Reading a fragment, or refusing

The seam that keeps a half-read snapshot off the recruiter's screen. Returns a tagged result rather than throwing, so every refusal reason is assertable as data — the same shape `railView` uses for `'no-match'` versus `'no-projects'`.

**Files:**
- Modify: `static/snapshot.js` (append)
- Modify: `tests/snapshot.test.js` (append)

**Interfaces:**
- Consumes: `decodeSnapshot` from Task 2.
- Produces: `readSnapshot(fragment) -> Promise<{ ok: true, snapshot: Snapshot } | { ok: false, reason: Reason }>` where `Reason` is `'no-link' | 'unreadable' | 'unsupported-version' | 'unsupported-browser'`. Accepts a fragment with or without its leading `#`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/snapshot.test.js`, adding `readSnapshot` to the existing import:

```js
async function payloadFor(mutate = () => {}) {
  const snapshot = snapshotFrom(journal(), 'project-a', { who: 'G', grouping: 'milestone' });
  mutate(snapshot);
  return encodeSnapshot(snapshot);
}

test('a good fragment reads back, with or without its hash', async () => {
  const payload = await payloadFor();
  for (const fragment of [payload, `#${payload}`]) {
    const result = await readSnapshot(fragment);
    assert.equal(result.ok, true);
    assert.equal(result.snapshot.project.name, 'Platform Migration');
    assert.equal(result.snapshot.entries.length, 2);
  }
});

test('no fragment is a different state from a broken one', async () => {
  for (const fragment of ['', '#', null, undefined]) {
    assert.deepEqual(await readSnapshot(fragment), { ok: false, reason: 'no-link' });
  }
});

test('a truncated fragment refuses rather than rendering less', async () => {
  const payload = await payloadFor();
  assert.deepEqual(await readSnapshot(payload.slice(0, 20)), { ok: false, reason: 'unreadable' });
  assert.deepEqual(await readSnapshot('garbage'), { ok: false, reason: 'unreadable' });
});

/* A link cannot be re-sent, so a payload from a newer build has to say so
   rather than render whichever fields it happens to recognise. */
test('a version this build does not know is named as such', async () => {
  assert.deepEqual(
    await readSnapshot(await payloadFor((snapshot) => { snapshot.version = 2; })),
    { ok: false, reason: 'unsupported-version' },
  );
});

test('a payload with no version at all is simply unreadable', async () => {
  assert.deepEqual(
    await readSnapshot(await payloadFor((snapshot) => { delete snapshot.version; })),
    { ok: false, reason: 'unreadable' },
  );
});

/* Every field is checked because there is no second chance: a snapshot that
   lost its entries would otherwise render as a project with nothing in it. */
test('a snapshot missing any required field is unreadable, not partial', async () => {
  const cases = [
    (snapshot) => { delete snapshot.project; },
    (snapshot) => { delete snapshot.project.name; },
    (snapshot) => { delete snapshot.entries; },
    (snapshot) => { snapshot.entries = []; },
    (snapshot) => { snapshot.entries = 'not an array'; },
    (snapshot) => { delete snapshot.entries[0].title; },
    (snapshot) => { delete snapshot.entries[0].markdown; },
    (snapshot) => { snapshot.entries[0].date = 'not-a-date'; },
  ];
  for (const [index, mutate] of cases.entries()) {
    assert.deepEqual(
      await readSnapshot(await payloadFor(mutate)),
      { ok: false, reason: 'unreadable' },
      `case ${index} should be unreadable`,
    );
  }
});

test('a browser with no DecompressionStream is told so, not shown a broken page', async () => {
  const real = globalThis.DecompressionStream;
  delete globalThis.DecompressionStream;
  try {
    assert.deepEqual(await readSnapshot('anything'), { ok: false, reason: 'unsupported-browser' });
  } finally {
    globalThis.DecompressionStream = real;
  }
});

/* Blank is legitimate for these three; absent is not. */
test('an optional field may be blank but not missing', async () => {
  const blank = await readSnapshot(await payloadFor((snapshot) => {
    snapshot.who = '';
    snapshot.project.description = '';
    snapshot.entries[0].milestone = '';
  }));
  assert.equal(blank.ok, true);
  assert.deepEqual(
    await readSnapshot(await payloadFor((snapshot) => { delete snapshot.who; })),
    { ok: false, reason: 'unreadable' },
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/snapshot.test.js`

Expected: FAIL — `readSnapshot is not defined`.

- [ ] **Step 3: Write the minimal implementation**

Append to `static/snapshot.js`:

```js
/* ---------------------------------------------------------------- reading */

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' ? value : null;
}

function filled(value) {
  const result = text(value);
  return result && result.trim() ? result : null;
}

/**
 * A version 1 snapshot, or `null` if this is not exactly one.
 *
 * Every field is checked. A snapshot that renders with a field missing is
 * worse than one that refuses: the reader cannot tell an incomplete page from
 * a short career, and the sender never finds out either way.
 */
function readVersion1(value) {
  if (!isRecord(value) || !isRecord(value.project) || !Array.isArray(value.entries)) return null;
  if (!value.entries.length) return null;

  const who = text(value.who);
  const name = filled(value.project.name);
  const description = text(value.project.description);
  const startedOn = filled(value.project.startedOn);
  if (who === null || name === null || description === null || startedOn === null) return null;
  if (!CALENDAR_DATE.test(startedOn)) return null;

  const entries = [];
  for (const candidate of value.entries) {
    if (!isRecord(candidate)) return null;
    const title = filled(candidate.title);
    const date = filled(candidate.date);
    const milestone = text(candidate.milestone);
    const markdown = filled(candidate.markdown);
    if (title === null || date === null || milestone === null || markdown === null) return null;
    if (!CALENDAR_DATE.test(date)) return null;
    entries.push({ title, date, milestone, markdown });
  }

  return {
    version: 1,
    who,
    grouping: value.grouping === 'milestone' ? 'milestone' : 'date',
    project: { name, description, startedOn },
    entries,
  };
}

/* A link cannot be re-sent once it is out, so every version this app has ever
   written stays readable — see docs/adr/0004. Adding a format means adding a
   reader here and leaving the others exactly as they are. */
const READERS = { 1: readVersion1 };

/**
 * A snapshot from a URL fragment, or the named reason there isn't one.
 *
 * Answers with a reason rather than throwing because the four ways this fails
 * read very differently to whoever opened the link, and only one of them is
 * the sender's fault.
 */
export async function readSnapshot(fragment) {
  const payload = String(fragment ?? '').replace(/^#/, '');
  if (!payload) return { ok: false, reason: 'no-link' };
  if (typeof DecompressionStream !== 'function') return { ok: false, reason: 'unsupported-browser' };

  let candidate;
  try {
    candidate = await decodeSnapshot(payload);
  } catch {
    return { ok: false, reason: 'unreadable' };
  }

  if (!isRecord(candidate) || !Number.isInteger(candidate.version)) return { ok: false, reason: 'unreadable' };
  const reader = READERS[candidate.version];
  if (!reader) return { ok: false, reason: 'unsupported-version' };

  const snapshot = reader(candidate);
  return snapshot ? { ok: true, snapshot } : { ok: false, reason: 'unreadable' };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/snapshot.test.js`

Expected: PASS, 19 tests.

- [ ] **Step 5: Commit**

```bash
git add static/snapshot.js tests/snapshot.test.js && git commit -m "Refuse a snapshot that cannot be read in full" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 4: The share view model

What the share page *says* about a snapshot, as data. A sibling of `activeView` in `static/view.js`, not a reuse of it: `activeView` renders `updatedStamp` from `project.updatedAt`, which a snapshot deliberately does not carry, and it computes `canMoveUp`/`canMoveDown`, which a read-only page has no use for.

**Files:**
- Create: `static/snapshot-view.js`
- Create: `tests/snapshot-view.test.js`

**Interfaces:**
- Consumes: `Snapshot` from Task 1; `formatStamp` from `static/view.js`.
- Produces: `snapshotView(snapshot) -> { who, project, startedStamp, entryCount, groups }` where `groups` is `Array<{ key, label, count, rows }>` and each row is `{ entry, sequence, aside }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/snapshot-view.test.js`:

```js
/* Tests for the share page's view model (`static/snapshot-view.js`).
 *
 * Run from the project root:
 *
 *   node --test
 *
 * Same reasoning as tests/view.test.js: grouping, sequence numbers and stamps
 * are derivations, so they are asserted as data rather than by building DOM
 * and reading it back.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { snapshotView } from '../static/snapshot-view.js';

function snapshot(extra = {}) {
  return {
    version: 1,
    who: 'Gerardo Meza Jr.',
    grouping: 'date',
    project: { name: 'Platform Migration', description: 'Consolidating.', startedOn: '2026-01-05' },
    entries: [
      { title: 'Cut the release cycle', date: '2026-03-04', milestone: 'Delivery', markdown: 'Rebuilt it.' },
      { title: 'Second pass', date: '2026-03-04', milestone: '', markdown: 'Tidied up.' },
      { title: 'Kickoff', date: '2026-01-06', milestone: 'Design', markdown: 'Scoped the work.' },
    ],
    ...extra,
  };
}

test('the header carries the owner and the project, and nothing about editing', () => {
  const view = snapshotView(snapshot());
  assert.equal(view.who, 'Gerardo Meza Jr.');
  assert.equal(view.project.name, 'Platform Migration');
  assert.equal(view.startedStamp, '05 JAN 2026');
  assert.equal(view.entryCount, 3);
  /* `updatedStamp` would tell a recruiter when the file was last touched,
     which is an editing habit rather than work. It must not exist here. */
  assert.equal('updatedStamp' in view, false);
});

test('grouping by date buckets by day and shows the milestone alongside', () => {
  const view = snapshotView(snapshot());
  assert.deepEqual(view.groups.map((group) => group.label), ['04 MAR 2026', '06 JAN 2026']);
  assert.deepEqual(view.groups.map((group) => group.count), [2, 1]);
  assert.deepEqual(view.groups[0].rows.map((row) => row.aside), ['Delivery', '—']);
});

test('grouping by milestone buckets by milestone and shows the date alongside', () => {
  const view = snapshotView(snapshot({ grouping: 'milestone' }));
  assert.deepEqual(view.groups.map((group) => group.label), ['Delivery', 'Unassigned', 'Design']);
  assert.deepEqual(view.groups[0].rows.map((row) => row.aside), ['04 MAR 2026']);
});

/* Same rule as the app: the first record ever written keeps its number, so a
   snapshot and the journal it came from read alike. */
test('sequence numbers count down so the oldest entry stays 01', () => {
  const view = snapshotView(snapshot());
  assert.deepEqual(view.groups.flatMap((group) => group.rows).map((row) => row.sequence), [3, 2, 1]);
});

test('stored order is preserved rather than re-sorted', () => {
  const value = snapshot();
  value.entries.reverse();
  const view = snapshotView(value);
  assert.deepEqual(
    view.groups.flatMap((group) => group.rows).map((row) => row.entry.title),
    ['Kickoff', 'Second pass', 'Cut the release cycle'],
  );
});

test('a row carries no move affordances', () => {
  const [row] = snapshotView(snapshot()).groups[0].rows;
  assert.equal('canMoveUp' in row, false);
  assert.equal('canMoveDown' in row, false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/snapshot-view.test.js`

Expected: FAIL — `Cannot find module '../static/snapshot-view.js'`

- [ ] **Step 3: Write the minimal implementation**

Create `static/snapshot-view.js`:

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/snapshot-view.test.js`

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add static/snapshot-view.js tests/snapshot-view.test.js && git commit -m "Describe a shared log without the owner's editing history" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The share page renders a snapshot

The page a recruiter opens. Loads `snapshot.js`, `snapshot-view.js`, `markdown.js`, `dom.js` and `view.js` — and nothing that can change a journal.

**Files:**
- Create: `static/share.html`
- Create: `static/share.css`
- Create: `static/share.js`

**Interfaces:**
- Consumes: `readSnapshot` (Task 3), `snapshotView` (Task 4), `renderMarkdown` from `static/markdown.js`, `h` from `static/dom.js`.
- Produces: nothing importable. Task 6 appends refusal rendering to `share.js`; Task 7 appends preview affordances.

- [ ] **Step 1: Create the page shell**

Create `static/share.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <meta name="description" content="A shared accomplishment log." />
  <title>Accomplishment Log</title>
  <link rel="stylesheet" href="./share.css" />
</head>
<body>
  <main class="sheet" id="sheet"></main>

  <footer class="foot">
    <p class="mono">
      A shared accomplishment log. Its contents were supplied by whoever sent this link.
    </p>
  </footer>

  <script type="module" src="./share.js"></script>
</body>
</html>
```

The `noindex` and the footer line are the two cheap halves of an accepted trade-off: this page renders whatever is in the fragment, so it should not accumulate in search results and should not present unattributed text as the site owner's own.

- [ ] **Step 2: Create the stylesheet**

Create `static/share.css`. A light document that keeps the app's signal colour and monospace metadata layer, follows `prefers-color-scheme`, and always prints light. No `@import`, no remote fonts — the recipient's browser makes no third-party request.

```css
/* Accomplishment Journal — the shared log.
 *
 * Self-contained on purpose. The app's stylesheet pulls Inter and JetBrains
 * Mono from Google, which is the owner's business on the owner's machine and
 * nobody else's on a page the owner sent to a stranger. System stacks only.
 *
 * Light by default where app.css is near-black: this is a document somebody
 * may print or paste into a form, not a writing surface.
 */

:root {
  --paper:      #fbfbfa;
  --raised:     #ffffff;
  --line:       #e3e2df;
  --line-2:     #cfceca;
  --ink:        #16181a;
  --ink-2:      #45494d;
  --ink-3:      #6f7479;
  --signal:     #5e6825;
  --signal-dim: #8a9640;

  --sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --mono: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace;
}

@media (prefers-color-scheme: dark) {
  :root {
    --paper:  #0a0b0c;
    --raised: #0e1012;
    --line:   #1c1f22;
    --line-2: #2d3135;
    --ink:    #e9eaeb;
    --ink-2:  #b7bbbe;
    --ink-3:  #7d8286;
    --signal: #d3e04f;
    --signal-dim: #96a337;
  }
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--sans);
  font-size: 15px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}

.mono {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-3);
}

.sheet {
  max-width: 46rem;
  margin: 0 auto;
  padding: 56px 24px 24px;
}

/* ---- header ---- */

.head { border-bottom: 1px solid var(--line-2); padding-bottom: 24px; }
.head-who { margin: 0 0 6px; }
.head h1 {
  margin: 0;
  font-size: 30px;
  line-height: 1.15;
  letter-spacing: -0.02em;
  font-weight: 600;
}
.head-desc { margin: 12px 0 0; color: var(--ink-2); max-width: 34rem; }
.head-meta { margin: 18px 0 0; display: flex; gap: 20px; flex-wrap: wrap; }

/* ---- groups and entries ---- */

.group { margin-top: 40px; }
.group-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--line);
}
.group-head b { color: var(--ink-2); font-weight: 500; }

.entry { padding: 22px 0; border-bottom: 1px solid var(--line); }
.entry:last-child { border-bottom: 0; }
.entry-top { display: flex; align-items: baseline; gap: 12px; }
.entry-seq { color: var(--signal-dim); }
.entry-aside { margin-left: auto; }
.entry h2 {
  margin: 6px 0 0;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

/* ---- refusals (Task 6) ---- */

.refusal { max-width: 32rem; margin: 12vh auto; text-align: center; }
.refusal h1 { font-size: 20px; font-weight: 600; margin: 0 0 12px; }
.refusal p { color: var(--ink-2); margin: 0; }

/* ---- footer ---- */

.foot {
  max-width: 46rem;
  margin: 0 auto;
  padding: 32px 24px 56px;
  border-top: 1px solid var(--line);
}
.foot p { margin: 0; text-transform: none; letter-spacing: 0.02em; }

/* ---- prose ----
   The log is written in the app's Markdown subset, so these mirror the
   `.prose` rules in app.css. They are restated rather than imported because
   importing app.css would pull in Google Fonts and the whole dark ground. */

.prose { color: var(--ink-2); }
.prose > * + * { margin-top: 12px; }
.prose h1, .prose h2, .prose h3 { color: var(--ink); font-weight: 600; letter-spacing: -0.01em; margin: 20px 0 0; }
.prose h1 { font-size: 19px; }
.prose h2 { font-size: 16.5px; }
.prose h3 { font-size: 14.5px; }
.prose ul, .prose ol { padding-left: 18px; margin-bottom: 0; }
.prose li { margin-top: 4px; padding-left: 4px; }
.prose li::marker { color: var(--ink-3); }
.prose blockquote {
  margin: 12px 0 0;
  border-left: 2px solid var(--line-2);
  padding-left: 14px;
  color: var(--ink-3);
}
.prose code {
  font-family: var(--mono);
  font-size: 0.9em;
  background: var(--raised);
  border: 1px solid var(--line);
  border-radius: 3px;
  padding: 1px 5px;
}
.prose pre {
  background: var(--raised);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 12px 14px;
  overflow-x: auto;
}
.prose pre code { background: none; border: 0; padding: 0; }
.prose a { color: var(--signal); text-decoration: underline; text-underline-offset: 2px; }
.prose strong { color: var(--ink); font-weight: 600; }

/* ---- print ----
   Recruiters print and paste. Always on white, whatever the screen was. */

@media print {
  :root {
    --paper: #ffffff; --raised: #ffffff;
    --line: #d8d8d4; --line-2: #b4b4b0;
    --ink: #000000; --ink-2: #1f2124; --ink-3: #4a4d50;
    --signal: #3f4718; --signal-dim: #5e6825;
  }
  body { font-size: 11pt; }
  .sheet { max-width: none; padding: 0; }
  .foot { border-top: 1px solid var(--line); padding: 12px 0 0; }
  .preview-bar { display: none !important; }
  .group, .entry { break-inside: avoid; }
  .group-head { break-after: avoid; }
  .prose a { color: inherit; }
}
```

- [ ] **Step 3: Write the page script for the success path**

Create `static/share.js`:

```js
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
```

- [ ] **Step 4: Verify it renders**

There is no Node test for this file — it is DOM plumbing, and per ADR-0003 the transformations behind it are already asserted in Tasks 3 and 4. Verify it in a browser instead.

Build a payload and open the page:

```bash
node --input-type=module -e "import { snapshotFrom, encodeSnapshot } from './static/snapshot.js'; const state = { version: 3, projects: [{ id: 'p', name: 'Platform Migration', description: 'Consolidating legacy services.', startedOn: '2026-01-05', tags: [], updatedAt: '2026-04-01T09:00:00.000Z' }], achievements: [{ id: 'e1', projectId: 'p', title: 'Cut the release cycle', date: '2026-03-04', milestone: 'Delivery', markdown: '## What changed\n\nRebuilt the deploy pipeline.\n\n- Cut p95 latency 40%\n- Removed two manual gates\n\n> Coordinated with two teams.' }, { id: 'e2', projectId: 'p', title: 'Kickoff', date: '2026-01-06', milestone: 'Design', markdown: 'Scoped the work with \`inline code\` and a [link](https://example.com).' }] }; console.log(await encodeSnapshot(snapshotFrom(state, 'p', { who: 'Gerardo Meza Jr.', grouping: 'date' })));"
```

Serve `static/` and open `share.html#<the payload printed above>`.

Confirm: the owner's name, project name, description, started stamp and entry count appear; entries are grouped by date; sequence numbers count down; Markdown renders with headings, lists, quote, code and link; the link opens in a new tab. Check `prefers-color-scheme: dark`, then the browser's print preview — the print view must be black on white with no dark ground.

Confirm the network panel shows **no** request to `fonts.googleapis.com` or `fonts.gstatic.com`.

- [ ] **Step 5: Commit**

```bash
git add static/share.html static/share.css static/share.js && git commit -m "Render a shared log on a page that cannot change one" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The share page refuses

Four ways a link fails, four things to say. This is the task that keeps a blank page from telling a recruiter the sender has no accomplishments.

**Files:**
- Modify: `static/share.js`

**Interfaces:**
- Consumes: the `reason` values produced by `readSnapshot` in Task 3.
- Produces: nothing importable.

- [ ] **Step 1: Add the refusal copy and renderer**

In `static/share.js`, add above `start()`:

```js
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
```

- [ ] **Step 2: Route failures into it**

Replace `start()` with:

```js
async function start() {
  const result = await readSnapshot(window.location.hash);
  if (result.ok) renderSnapshot(result.snapshot);
  else renderRefusal(result.reason);
}
```

- [ ] **Step 3: Verify each refusal in a browser**

With `static/` served, open `share.html` and confirm each case:

| Open | Expect |
|---|---|
| `share.html` | "Nothing to show" |
| `share.html#garbage` | "This link is incomplete" |
| `share.html#` + the first 20 chars of a real payload | "This link is incomplete" |
| a real payload, after running `delete DecompressionStream` in the console and reloading with the same hash | "This browser cannot open the link" |

For `unsupported-version`, build one:

```bash
node --input-type=module -e "import { encodeSnapshot } from './static/snapshot.js'; console.log(await encodeSnapshot({ version: 2, who: '', grouping: 'date', project: { name: 'X', description: '', startedOn: '2026-01-05' }, entries: [{ title: 'T', date: '2026-01-06', milestone: '', markdown: 'B' }] }));"
```

Expect "This link needs a newer page".

**The thing to check hardest:** in every failing case the page must show a refusal and nothing else. A heading with an empty body underneath it is the bug this task exists to prevent.

- [ ] **Step 4: Commit**

```bash
git add static/share.js && git commit -m "Say which way a shared link failed instead of showing an empty log" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Preview mode

The same page, opened by the sender, with a bar on top. The link is copied from here and nowhere else, so it cannot be sent unlooked-at.

The preview is marked with a query parameter rather than a second page: `?preview=1` is outside the fragment, so the URL the sender copies — fragment only — is exactly what the recipient opens.

**Files:**
- Modify: `static/share.js`
- Modify: `static/share.css` (append)

**Interfaces:**
- Consumes: `SAFE_URL_LENGTH` from `static/snapshot.js`.
- Produces: the preview contract Task 8 calls — open `share.html?preview=1#<payload>`, optionally with `&base=<encoded absolute URL of the published share page>`. When `base` is present the bar copies `base + '#' + payload` and says the preview is a local copy; when absent it copies the current URL with `?preview=1` removed.

- [ ] **Step 1: Add the preview bar styles**

Append to `static/share.css`, above the `@media print` block:

```css
/* ---- preview bar ----
   Only the sender ever sees this; `?preview=1` is not part of the link. */

.preview-bar {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--raised);
  border-bottom: 1px solid var(--line-2);
  padding: 12px 24px;
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.preview-bar p { margin: 0; text-transform: none; letter-spacing: 0.02em; }
.preview-bar .warn { color: var(--ink); }
.preview-copy {
  margin-left: auto;
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  background: var(--signal);
  color: var(--paper);
  border: 0;
  border-radius: 3px;
  padding: 8px 14px;
  cursor: pointer;
}
.preview-copy:hover { background: var(--signal-dim); }
```

- [ ] **Step 2: Add the preview bar to `share.js`**

Add `SAFE_URL_LENGTH` to the existing import from `./snapshot.js`, then add above `start()`:

```js
/**
 * The bar the sender sees, and the only place a link can be copied from.
 *
 * Copying from the rendered page rather than from the app is the whole of the
 * consent gate: a snapshot cannot be withdrawn, so the one moment to notice
 * what is in it is before the link exists anywhere else.
 */
function renderPreviewBar(params) {
  const payload = window.location.hash.replace(/^#/, '');
  const base = params.get('base');
  const link = base ? `${base}#${payload}` : `${window.location.origin}${window.location.pathname}#${payload}`;

  const copy = h('button', { type: 'button', class: 'preview-copy' }, 'Copy link');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(link);
      copy.textContent = 'Copied';
    } catch {
      /* Clipboard access can be refused outright. Selecting the link is a
         worse experience than copying it and a much better one than a button
         that silently does nothing. */
      window.prompt('Copy this link:', link);
    }
  });

  const notes = [
    h('p', { class: 'mono' }, 'Preview — this is what your recipient sees.'),
    base && h('p', { class: 'mono' }, 'Shown from this machine; the link points at your published page.'),
    link.length > SAFE_URL_LENGTH && h('p', { class: 'mono warn' },
      `This link is ${link.length.toLocaleString()} characters. Some email programs break links this long by wrapping them — send it as a clickable link rather than pasted text.`),
  ];

  document.body.prepend(h('div', { class: 'preview-bar' }, notes, copy));
}
```

- [ ] **Step 3: Call it from `start()`**

Replace `start()` with:

```js
async function start() {
  const result = await readSnapshot(window.location.hash);
  if (result.ok) renderSnapshot(result.snapshot);
  else renderRefusal(result.reason);

  /* The bar goes up only for a snapshot that actually rendered: offering to
     copy a link that just refused to open is offering to send a broken one. */
  const params = new URLSearchParams(window.location.search);
  if (result.ok && params.get('preview') === '1') renderPreviewBar(params);
}
```

- [ ] **Step 4: Verify in a browser**

With `static/` served and a real payload from Task 5:

| Open | Expect |
|---|---|
| `share.html#<payload>` | No bar. This is the recipient's view. |
| `share.html?preview=1#<payload>` | Bar with "Preview", a Copy link button. Copied link has no `?preview=1`. |
| `share.html?preview=1&base=https%3A%2F%2Fexample.github.io%2Faccomplishment-journal%2Fshare.html#<payload>` | Bar also says the link points at the published page; the copied link starts with that base. |
| `share.html?preview=1#garbage` | Refusal, and **no bar** — there is nothing safe to copy. |
| a payload over 2,000 chars with `?preview=1` | The length warning appears, and the Copy button still works. |

Print preview with the bar up: the bar must not appear on the printed page.

- [ ] **Step 5: Commit**

```bash
git add static/share.js static/share.css && git commit -m "Copy a snapshot link only from the page it will open" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 8: Share, wired into the app

The button, the owner's name, and the rule that a project with no entries cannot be shared.

**Files:**
- Modify: `static/index.html` (the `rail-ops` block)
- Modify: `static/app.js`

**Interfaces:**
- Consumes: `snapshotFrom` and `encodeSnapshot` from `static/snapshot.js`; the preview contract from Task 7.
- Produces: nothing importable. Task 10 replaces the `HOSTED_ON_PAGES` gate added here.

- [ ] **Step 1: Add the button**

In `static/index.html`, in the `rail-ops` div, add `Share` after the CSV button:

```html
        <div class="rail-ops mono">
          <button type="button" id="op-backup">Backup</button>
          <button type="button" id="op-restore">Restore</button>
          <button type="button" id="op-csv" disabled>CSV</button>
          <button type="button" id="op-share" disabled>Share</button>
        </div>
```

No CSS change is needed — `.rail-ops button` already styles this and `:disabled` is already handled.

- [ ] **Step 2: Import the snapshot module**

In `static/app.js`, add after the `./journal.js` import block:

```js
import { encodeSnapshot, snapshotFrom } from './snapshot.js';
```

- [ ] **Step 3: Store the owner's name outside the journal**

Add to `static/app.js` near `toLocalDateInput`:

```js
/* The owner's name is not a journal fact — CONTEXT.md defines a journal as
   projects and entries — so it is kept beside the journal rather than in it.
   Putting it in the state would mean a version 4 format, a migration on both
   builds, and a default for every backup ever written, all for one string. */
const AUTHOR_KEY = 'accomplishment-journal-author';

function ownerName() {
  let stored;
  try {
    stored = localStorage.getItem(AUTHOR_KEY);
  } catch {
    stored = null;
  }
  if (stored !== null) return stored;

  const asked = window.prompt('What name should appear on shared logs? Leave it blank to share without one.', '');
  if (asked === null) return null;

  const name = asked.trim();
  try {
    localStorage.setItem(AUTHOR_KEY, name);
  } catch {
    /* A browser refusing storage should not block the share; the name is
       simply asked for again next time. */
  }
  return name;
}
```

`ownerName()` returns `null` only when the prompt was cancelled, which cancels the share. A blank name is a real answer and is remembered as one.

- [ ] **Step 4: Add the share action**

Add to `static/app.js` in the data-actions section, after `exportCsv`:

```js
/* Stage 1 ships snapshots on the hosted build only. The local build needs
   app.py to serve share.html and to say where the published page lives;
   until then the button would produce a preview that 404s. */
const CAN_SHARE = HOSTED_ON_PAGES;

async function shareProject() {
  const { active } = currentView();
  if (!active) { setNotice('Choose a project before sharing it.'); return; }
  if (!active.entryCount) { setNotice('Record an entry before sharing this project.'); return; }

  const who = ownerName();
  if (who === null) return;

  try {
    const snapshot = snapshotFrom(app.state, active.project.id, { who, grouping: app.grouping });
    const payload = await encodeSnapshot(snapshot);
    const url = new URL('share.html', window.location.href);
    url.searchParams.set('preview', '1');

    /* The preview is opened, never the link itself, and the link is copied
       from that page rather than from here. A snapshot cannot be withdrawn,
       so the only moment to see what is in it is before it exists anywhere. */
    const opened = window.open(`${url.toString()}#${payload}`, '_blank', 'noopener');
    if (!opened) { setNotice('Allow pop-ups for this page to preview a shared log.'); return; }
    setNotice('Preview opened. Copy the link from that page to share it.');
  } catch (error) {
    setNotice(error instanceof Error ? error.message : 'That project could not be shared.');
  }
}
```

- [ ] **Step 5: Disable the button when there is nothing to share**

In `renderTopbar`, below the existing `refs.opCsv.disabled` line:

```js
function renderTopbar(view = currentView()) {
  refs.topbarNow.textContent = view.active?.project.name ?? 'No project selected';
  refs.opCsv.disabled = !view.active;
  /* A project with no entries makes a page that reads "this person has no
     accomplishments". The same distinction railView draws between `no-match`
     and `no-projects`: empty and broken are not the same state. */
  refs.opShare.disabled = !CAN_SHARE || !view.active || view.active.entryCount === 0;
}
```

- [ ] **Step 6: Register the ref and the listener**

In `init()`, beside `refs.opCsv`:

```js
  refs.opShare = $('#op-share');
```

In `bindEvents()`, beside the CSV listener:

```js
  refs.opShare.addEventListener('click', shareProject);
```

- [ ] **Step 7: Verify in a browser**

Serve `static/` over a hostname ending in `.github.io` or temporarily change the `HOSTED_ON_PAGES` check to `true` to exercise the hosted path locally. Then:

| Do | Expect |
|---|---|
| No project selected | Share is disabled |
| Select a project with no entries | Share stays disabled |
| Select a project with entries | Share is enabled |
| Click Share the first time | Prompted for a name; preview opens in a new tab showing that name |
| Click Share again | No prompt; the name is remembered |
| Copy the link from the preview, open it in a fresh tab | The log renders with no preview bar |
| Switch grouping to milestone, share again | The new preview is grouped by milestone |

Then check the leak list directly — paste the payload from the preview URL into:

```bash
node --input-type=module -e "import { decodeSnapshot } from './static/snapshot.js'; console.log(JSON.stringify(await decodeSnapshot(process.argv[1]), null, 2));" -- "<payload>"
```

Confirm no `id`, `projectId`, `createdAt`, `updatedAt` or `tags` appears.

- [ ] **Step 8: Run the whole suite**

Run: `node --test`

Expected: PASS, all files. Nothing in this task should have changed an existing test.

- [ ] **Step 9: Commit**

```bash
git add static/index.html static/app.js && git commit -m "Share one project's log from the rail, through a preview" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: The vocabulary, the promise, and the ADR

A new concept needs a name in `CONTEXT.md` before it needs code, and a link that cannot be withdrawn is an architectural commitment, not an implementation detail.

**Files:**
- Modify: `CONTEXT.md`
- Modify: `README.md`
- Create: `docs/adr/0004-a-snapshot-cannot-be-withdrawn.md`

**Interfaces:** none.

- [ ] **Step 1: Add the term to `CONTEXT.md`**

Add to the end of the "The record" section, after **Backup**:

```markdown
**Snapshot**  
A frozen, self-contained copy of one project's accomplishment log, encoded
into a link. A snapshot is made for one named person. It cannot be changed or
withdrawn once it is sent, and the journal it came from can change afterwards
without changing it.
```

- [ ] **Step 2: Add the section to `README.md`**

Add after the "Use the hosted app" section:

```markdown
## Share one project

**Share** builds a *snapshot*: a frozen copy of one project's log, encoded
into the link itself. A snapshot cannot be changed or withdrawn once sent, and
editing the journal afterwards never changes a link already sent.

The journal content rides in the link's fragment, which browsers never
transmit to a server — so GitHub never receives it, nothing is committed to
this repository, and the recipient needs nothing installed.

Sharing always opens a preview first. That preview is the recipient's page,
and the link is copied from it, so nothing can be sent unlooked-at.

A snapshot carries the project's name, description and start date, the owner's
name, and each entry's title, date, milestone and writing. It deliberately
carries no internal identifiers, no created or updated timestamps, and no
project tags.

Long links are the one limitation: roughly ten entries of prose reaches 2,000
characters, and some email programs break links longer than that by wrapping
them. The preview warns when a link crosses that line.
```

Then update the sentence in "Use the hosted app" that reads "No journal entries are published to GitHub: each browser stores its own copy locally." to:

```markdown
to GitHub: each browser stores its own copy locally, and a shared snapshot
travels inside the link rather than through this repository. Use **Backup** on
```

(Keep the surrounding sentence intact — the claim stays true, it just now says why it stays true when sharing.)

- [ ] **Step 3: Write the ADR**

Create `docs/adr/0004-a-snapshot-cannot-be-withdrawn.md`:

```markdown
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

## What this decision is not

It is not a duplication of a journal rule, and ADR-0002 still holds. Encoding
a snapshot lives only in `static/snapshot.js`, and `app.py` has no encoder:
a snapshot cannot alter a journal, so it is presentation in the same sense
that rendering Markdown is. The local build's browser already holds the
journal it fetched from `/api/state` and encodes the snapshot there.
```

- [ ] **Step 4: Verify**

Run: `node --test` and `python -m tests.test_tracker`

Expected: both pass — this task changes no code.

Read `CONTEXT.md` end to end and confirm the Snapshot definition uses the vocabulary already established there (*project*, *accomplishment log*, *entry*) rather than introducing synonyms.

- [ ] **Step 5: Commit**

```bash
git add CONTEXT.md README.md docs/adr/0004-a-snapshot-cannot-be-withdrawn.md && git commit -m "Name the snapshot and record what sending one commits to" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Stage 1 ends here.** Push, let Pages deploy, and share a real project with yourself by email before starting Task 10. The URL-length numbers in this plan are measurements, not guarantees about your mail client.

---

### Task 10: The local build shares too

Stage 2. The browser already encodes the snapshot, so this task is only about two things `app.py` alone knows: where `share.html` is on disk, and where the published copy lives.

**Files:**
- Modify: `app.py`
- Modify: `static/app.js`
- Modify: `README.md` (the HTTP API table)
- Create: `tests/test_app.py`

**Interfaces:**
- Consumes: the preview contract from Task 7 (`?preview=1&base=<url>`).
- Produces:
  - `app.pages_url_from_git_config(base_dir) -> str | None` — the published share page derived from `origin`, or `None` when it cannot be derived.
  - `GET /api/config` -> `{"shareBase": "<url or empty string>"}`.

- [ ] **Step 1: Write the failing test for the derived URL**

Create `tests/test_app.py`:

```python
"""Tests for the local server's own decisions (``app.py``).

Run from the project root:

    python -m tests.test_app
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

# Make the project root importable no matter where this is run from.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app  # noqa: E402

PASS = 0
FAIL = 0


def check(name: str, condition: bool, detail: str = "") -> None:
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  ok    {name}")
    else:
        FAIL += 1
        print(f"  FAIL  {name}  {detail}")


def with_remote(url: str | None):
    """A throwaway directory holding a .git/config with the given origin."""
    root = Path(tempfile.mkdtemp())
    config = root / ".git"
    config.mkdir()
    body = '[core]\n\trepositoryformatversion = 0\n'
    if url is not None:
        body += f'[remote "origin"]\n\turl = {url}\n'
    (config / "config").write_text(body, encoding="utf-8")
    return root


def test_derives_the_pages_url() -> None:
    cases = [
        ("https://github.com/jerrymeza-exe/accomplishment-journal.git",
         "https://jerrymeza-exe.github.io/accomplishment-journal/share.html"),
        ("https://github.com/jerrymeza-exe/accomplishment-journal",
         "https://jerrymeza-exe.github.io/accomplishment-journal/share.html"),
        ("git@github.com:jerrymeza-exe/accomplishment-journal.git",
         "https://jerrymeza-exe.github.io/accomplishment-journal/share.html"),
    ]
    for url, expected in cases:
        got = app.pages_url_from_git_config(with_remote(url))
        check(f"derives from {url}", got == expected, f"got {got!r}")


def test_declines_to_guess() -> None:
    """A wrong-looking link 404s for the recipient and nobody reports it back,
    so anything unfamiliar answers None and lets --share-base decide."""
    for url in (None, "https://gitlab.com/someone/thing.git", "https://example.com/x"):
        got = app.pages_url_from_git_config(with_remote(url))
        check(f"declines {url}", got is None, f"got {got!r}")
    check("declines a directory with no .git", app.pages_url_from_git_config(Path(tempfile.mkdtemp())) is None)


def main() -> int:
    for test in (test_derives_the_pages_url, test_declines_to_guess):
        print(f"{test.__name__}")
        test()
    print(f"\n{PASS} passed, {FAIL} failed")
    return 1 if FAIL else 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python -m tests.test_app`

Expected: FAIL — `AttributeError: module 'app' has no attribute 'pages_url_from_git_config'`

- [ ] **Step 3: Derive the URL in `app.py`**

Add to `app.py` after the module constants, and add `import configparser` and `import re` to the imports:

```python
GITHUB_REMOTE = re.compile(r"^(?:https://github\.com/|git@github\.com:)([^/]+)/(.+?)(?:\.git)?$")


def pages_url_from_git_config(base_dir: str | os.PathLike[str] = BASE_DIR) -> str | None:
    """The published share page this repository would deploy to, if it can be told.

    A guess that is wrong produces a link that 404s in someone else's inbox,
    which nobody reports back, so anything that is not plainly a GitHub remote
    answers ``None`` and leaves it to ``--share-base``.
    """
    config_path = os.path.join(base_dir, ".git", "config")
    parser = configparser.ConfigParser()
    try:
        if not parser.read(config_path, encoding="utf-8"):
            return None
        url = parser.get('remote "origin"', "url", fallback="").strip()
    except (configparser.Error, OSError, UnicodeDecodeError):
        return None

    match = GITHUB_REMOTE.match(url)
    if not match:
        return None
    owner, repo = match.group(1), match.group(2)
    return f"https://{owner}.github.io/{repo}/share.html"
```

- [ ] **Step 4: Run it to verify it passes**

Run: `python -m tests.test_app`

Expected: PASS, 7 checks.

- [ ] **Step 5: Serve `share.html` and expose the share base**

In `app.py`'s `do_GET`, widen the root-level static rule so the share page is reachable at `/share.html`, matching where it sits on Pages:

```python
        # The page uses relative asset URLs so the same files also work from
        # a GitHub Pages project subpath, and share.html sits at the root
        # there too.
        if path.count("/") == 1 and path.rsplit(".", 1)[-1] in {"css", "js", "html"}:
            self._serve_static(path[1:])
            return
```

Add the config route beside `/healthz`:

```python
        if path == "/api/config":
            self._send_json(200, {"shareBase": SHARE_BASE})
            return
```

Add the module-level default and set it in `main`:

```python
# Where this journal's published share page lives. Only the local build needs
# this: the hosted build is already sitting next to its own share.html.
SHARE_BASE = ""
```

In `main`, after `args = parser.parse_args(argv)`:

```python
    parser.add_argument(
        "--share-base",
        default=None,
        help="URL of the published share page (default: derived from the git origin, if it is a GitHub remote).",
    )
```

(place that with the other `add_argument` calls), and after parsing:

```python
    global SHARE_BASE
    SHARE_BASE = args.share_base or pages_url_from_git_config() or ""
```

And in the startup banner, after the data-file line:

```python
    print(f"  Share base: {SHARE_BASE or 'not set — pass --share-base to enable sharing'}")
```

- [ ] **Step 6: Use it from the browser**

In `static/app.js`, replace the stage-1 gate. Delete the `const CAN_SHARE = HOSTED_ON_PAGES;` line and add beside the other app state:

```js
/* The hosted build sits next to its own share.html; the local build has to be
   told where the published one is, because the link it copies has to work for
   somebody who is not on this machine. */
let shareBase = '';
```

In `hydrate()`, in the non-Pages branch after `adopt(payload)`:

```js
      const config = await fetch('/api/config').then((answer) => answer.json()).catch(() => ({}));
      shareBase = config.shareBase ?? '';
```

In `renderTopbar`, replace the `CAN_SHARE` term:

```js
  refs.opShare.disabled = !(HOSTED_ON_PAGES || shareBase) || !view.active || view.active.entryCount === 0;
```

In `shareProject`, after `url.searchParams.set('preview', '1');`:

```js
    /* Locally the preview is served from this machine while the link points at
       the published page, so the preview says which is which rather than
       letting the sender assume the address bar is the link. */
    if (!HOSTED_ON_PAGES && shareBase) url.searchParams.set('base', shareBase);
```

- [ ] **Step 7: Update the README's API table**

Add to the HTTP API table, after the `/healthz` row:

```markdown
| `GET` | `/api/config` | Read the local server's share settings |
```

And in "Useful flags", after `python app.py --host 0.0.0.0`:

```powershell
python app.py --share-base https://you.github.io/accomplishment-journal/share.html
```

- [ ] **Step 8: Verify end to end**

```bash
python app.py --no-browser --port 3222
```

Confirm the banner prints a derived share base of `https://jerrymeza-exe.github.io/accomplishment-journal/share.html`.

| Do | Expect |
|---|---|
| `curl http://127.0.0.1:3222/api/config` | `{"shareBase": "https://jerrymeza-exe.github.io/..."}` |
| Open `http://127.0.0.1:3222/share.html` | The "Nothing to show" refusal — proving the route serves it |
| Select a project with entries, click Share | Preview opens on `127.0.0.1`, with the extra line about the published page |
| Copy the link from that preview | It starts with the Pages URL, not `127.0.0.1` |
| Run with `--share-base ""` | Share is disabled, and the banner says sharing is off |

- [ ] **Step 9: Run every suite**

```bash
node --test
```

```bash
python -m tests.test_tracker; python -m tests.test_store; python -m tests.test_journal; python -m tests.test_app
```

Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add app.py static/app.js README.md tests/test_app.py && git commit -m "Share from the local build with a link that points at the published page" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review notes

Checked against `docs/superpowers/specs/2026-09-04-snapshots.md`:

- **Spec coverage.** All 28 decisions map to a task. Decisions 1–3 and 22 are satisfied by omission (one project, no expiry mechanism, no share log) and are recorded in the spec's trade-offs rather than implemented. Decision 24's mitigation is the `noindex` tag and footer line in Task 5.
- **Deliberately deferred, per the spec's "Out of scope":** the downloadable HTML fallback for oversized projects, a local record of snapshots, multi-project shares, per-entry selection. None has a task.
- **Type consistency.** `Snapshot` is produced by `snapshotFrom` (Task 1), consumed by `encodeSnapshot` (Task 2), reproduced by `readSnapshot` (Task 3) and consumed by `snapshotView` (Task 4) — the same six keys throughout. The refusal reasons are the same four strings in Task 3's `READERS`/`readSnapshot`, Task 6's `REFUSALS`, and Task 6's verification table.
- **One thing to watch.** Task 3's `readVersion1` re-derives the snapshot rather than returning the decoded object, so the value that reaches `snapshotView` is always this build's shape regardless of what extra keys a payload carried. That is deliberate; do not "simplify" it into returning `candidate`.

## What has already been run

The code in this plan is not a sketch. Before the plan was saved:

- Tasks 1–4 were assembled verbatim from these code blocks and run under
  `node --test` on Node 24. **25 tests pass**, and the per-task counts stated
  in Tasks 1, 2, 3 and 4 (6, 11, 19, 6) are the real ones.
- Task 10's `pages_url_from_git_config` was run against all seven cases in its
  test, and against this repository's own `.git/config`, where it returns
  `https://jerrymeza-exe.github.io/accomplishment-journal/share.html`.
- The `.catch(() => {})` pair in `pipeBytes` is there because without it a
  corrupt payload produced an unhandled rejection that terminated the process.
  That was observed, not anticipated.

Tasks 5–9 are DOM, CSS and prose, and are verified in a browser by the steps
written into them.
