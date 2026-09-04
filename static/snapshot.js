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
