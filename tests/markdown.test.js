/* Tests for the log's Markdown parser (`static/markdown.js`).
 *
 * Run from the project root:
 *
 *   node --test tests/
 *
 * These assert on data, not on DOM: `parseBlocks` and `inlineParts` are the
 * seam that makes that possible. Node is needed to run them; the app itself
 * still needs nothing but Python.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseBlocks, inlineParts } from '../static/markdown.js';

test('an empty entry parses to nothing', () => {
  assert.deepEqual(parseBlocks(''), []);
  assert.deepEqual(parseBlocks('\n\n   \n'), []);
});

test('headings carry their level', () => {
  assert.deepEqual(parseBlocks('# One\n## Two\n### Three'), [
    { type: 'heading', level: 1, text: 'One' },
    { type: 'heading', level: 2, text: 'Two' },
    { type: 'heading', level: 3, text: 'Three' },
  ]);
});

test('a fourth-level heading is not a heading', () => {
  const [block] = parseBlocks('#### Four');
  assert.equal(block.type, 'paragraph');
});

test('legacy checkbox-like writing is preserved as ordinary bullet text', () => {
  assert.deepEqual(parseBlocks('- [x] completed review\n- [X] shared findings\n* [ ] old notation'), [
    { type: 'bullets', items: ['[x] completed review', '[X] shared findings', '[ ] old notation'] },
  ]);
});

test('legacy checkbox-like writing stays in its surrounding bullet run', () => {
  assert.deepEqual(parseBlocks('- first result\n- [ ] old notation\n- final note'), [
    { type: 'bullets', items: ['first result', '[ ] old notation', 'final note'] },
  ]);
});

test('ordered and bullet runs stay apart', () => {
  assert.deepEqual(parseBlocks('1. first\n2. second\n- loose'), [
    { type: 'ordered', items: ['first', 'second'] },
    { type: 'bullets', items: ['loose'] },
  ]);
});

test('a blockquote run becomes one block', () => {
  assert.deepEqual(parseBlocks('> one\n> two\n\nafter'), [
    { type: 'quote', lines: ['one', 'two'] },
    { type: 'paragraph', lines: ['after'] },
  ]);
});

test('a fenced block keeps its language and its content verbatim', () => {
  assert.deepEqual(parseBlocks('```python\n# not a heading\n- not a bullet\n```'), [
    { type: 'code', language: 'python', lines: ['# not a heading', '- not a bullet'] },
  ]);
});

test('an unterminated fence runs to the end of the entry', () => {
  assert.deepEqual(parseBlocks('```\nstill code\n\nstill code'), [
    { type: 'code', language: '', lines: ['still code', '', 'still code'] },
  ]);
});

test('a paragraph folds its line breaks and stops at the next block', () => {
  assert.deepEqual(parseBlocks('one\ntwo\n## Head'), [
    { type: 'paragraph', lines: ['one', 'two'] },
    { type: 'heading', level: 2, text: 'Head' },
  ]);
});

test('CRLF text parses the same as LF', () => {
  assert.deepEqual(parseBlocks('a\r\nb'), parseBlocks('a\nb'));
});

/* --- the inline pass, including the one rule with a security shape ------- */

test('inline code, bold and links are recognised', () => {
  assert.deepEqual(inlineParts('a `code` b **bold** c [text](https://example.com) d'), [
    { type: 'text', value: 'a ' },
    { type: 'code', value: 'code' },
    { type: 'text', value: ' b ' },
    { type: 'strong', value: 'bold' },
    { type: 'text', value: ' c ' },
    { type: 'link', text: 'text', href: 'https://example.com' },
    { type: 'text', value: ' d' },
  ]);
});

test('http, https and mailto are the only schemes that become links', () => {
  for (const href of ['http://a.example', 'https://a.example', 'mailto:someone@example.com', 'HTTPS://A.EXAMPLE']) {
    const parts = inlineParts(`[go](${href})`);
    assert.equal(parts[0].type, 'link', `expected ${href} to be a link`);
    assert.equal(parts[0].href, href);
  }
});

test('a disallowed scheme stays literal text and never becomes a link', () => {
  for (const href of ['javascript:alert(1)', 'data:text/html,<script>', 'vbscript:x', 'file:///etc/passwd', '/relative/path']) {
    const parts = inlineParts(`[go](${href})`);
    assert.ok(parts.every((part) => part.type !== 'link'), `expected ${href} not to be a link`);
  }
});

test('plain text with no markup is one part', () => {
  assert.deepEqual(inlineParts('nothing special here'), [
    { type: 'text', value: 'nothing special here' },
  ]);
});
