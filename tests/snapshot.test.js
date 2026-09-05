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

import { SNAPSHOT_VERSION, decodeSnapshot, encodeSnapshot, readSnapshot, snapshotFrom } from '../static/snapshot.js';

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

/* `readVersion1` already refuses a blank body, and both stores accept one from
   an imported v3 backup. Without the writer's check the sender gets a perfectly
   good link the preview then calls incomplete — telling them it broke in
   transit and to resend, when the only fix is back in the journal. */
test('an entry with nothing written in it cannot be snapshotted', () => {
  for (const body of ['', '   \n\t ']) {
    const state = journal();
    state.achievements[1].markdown = body;
    assert.throws(
      () => snapshotFrom(state, 'project-a', {}),
      /no writing cannot be shared/,
      `expected ${JSON.stringify(body)} to be refused before a link exists`,
    );
  }
});

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

/* Built by compressing straight to a payload rather than through
   `encodeSnapshot`, because no journal produces this: 6 MB of one repeated byte
   deflates to a comfortably mailable link that inflates back past the cap. The
   cost of not capping falls entirely on whoever opened the link — the one
   person who can do nothing about it — so it answers with the existing
   `unreadable`, adding no fifth reason. */
test('a payload that inflates past the cap is refused rather than allocated', async () => {
  const stream = new CompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  writer.write(new Uint8Array(6 * 1024 * 1024)).catch(() => {});
  writer.close().catch(() => {});

  const chunks = [];
  const reader = stream.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  const payload = Buffer.concat(chunks).toString('base64url');

  assert.ok(payload.length < 10000, `a ${payload.length}-character link would sail through email`);
  /* Matched on the cap's own message, not just on rejecting: without the cap
     this payload inflates in full and JSON.parse rejects it anyway, which would
     make the assertion pass while proving nothing about the ceiling. */
  await assert.rejects(() => decodeSnapshot(payload), /expands to far more/);
  assert.deepEqual(await readSnapshot(payload), { ok: false, reason: 'unreadable' });
});

/* The mail-client truncation case, which is the one that will actually
   happen. Every prefix has to fail loudly rather than decode to less. */
test('a truncated payload is rejected rather than half-read', async () => {
  const payload = await encodeSnapshot(snapshotFrom(journal(), 'project-a', {}));
  for (const cut of [4, 12, payload.length - 8, payload.length - 1]) {
    await assert.rejects(() => decodeSnapshot(payload.slice(0, cut)), `expected a ${cut}-char prefix to be rejected`);
  }
});

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

/* The mirror image on the writing side. Without the guard the owner clicks
   Share and gets `CompressionStream is not defined` in the notice bar, which
   reads as a broken app rather than an old browser. */
test('a browser with no CompressionStream says so instead of a ReferenceError', async () => {
  const real = globalThis.CompressionStream;
  delete globalThis.CompressionStream;
  try {
    await assert.rejects(
      () => encodeSnapshot(snapshotFrom(journal(), 'project-a', {})),
      /browser from 2023 or later/,
    );
  } finally {
    globalThis.CompressionStream = real;
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
