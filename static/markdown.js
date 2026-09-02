/* Accomplishment Journal — the entry writer's Markdown subset.
 *
 * Two steps with a seam between them:
 *
 *   parseBlocks(markdown) -> Block[]     plain data, no DOM
 *   renderBlocks(blocks)  -> Node        obvious node plumbing
 *
 * Callers still see one function, `renderMarkdown`. The split exists so the
 * parsing rules — including the link-scheme allowlist, which is the one rule
 * here with a security shape — can be asserted as data instead of by building
 * DOM and reading it back. See tests/markdown.test.js.
 *
 * Deliberately small: the log is prose, not a document format. Everything is
 * built as real nodes, so user text is never injected as HTML.
 */

import { h } from './dom.js';

const BULLET_ITEM = /^\s*[-*]\s+/;
const ORDERED_ITEM = /^\s*\d+\.\s+/;
const HEADING = /^(#{1,3})\s+(.+)$/;
const BLOCK_START = /^(#{1,3}\s+|>\s|\s*[-*]\s+|\s*\d+\.\s+|\s*```)/;
const INLINE_SPLIT = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
const LINK = /^\[([^\]]+)\]\(([^\s)]+)\)$/;

/* The only schemes a log entry may link out with. Anything else — javascript:,
   data:, a bare path — stays literal text rather than becoming a link. */
const ALLOWED_SCHEME = /^(https?:\/\/|mailto:)/i;

/* ------------------------------------------------------------------ parse */

/**
 * Split inline text into parts: `code`, **strong**, [links](…), and the plain
 * text between them. A link whose scheme is not allowed comes back as the
 * text it was written as.
 */
export function inlineParts(text) {
  return text
    .split(INLINE_SPLIT)
    .filter(Boolean)
    .map((part) => {
      if (part.startsWith('`') && part.endsWith('`')) return { type: 'code', value: part.slice(1, -1) };
      if (part.startsWith('**') && part.endsWith('**')) return { type: 'strong', value: part.slice(2, -2) };
      const link = LINK.exec(part);
      if (link && ALLOWED_SCHEME.test(link[2])) return { type: 'link', text: link[1], href: link[2] };
      return { type: 'text', value: part };
    });
}

/**
 * Parse a log entry into blocks. Every block is plain data:
 *
 *   { type: 'code', language, lines }
 *   { type: 'heading', level, text }
 *   { type: 'quote', lines }
 *   { type: 'bullets' | 'ordered', items }
 *   { type: 'paragraph', lines }
 */
export function parseBlocks(value) {
  const lines = String(value ?? '').replaceAll('\r\n', '\n').split('\n');
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }

    if (line.trimStart().startsWith('```')) {
      const code = [];
      const language = line.trim().slice(3).trim();
      index += 1;
      while (index < lines.length && !lines[index].trimStart().startsWith('```')) { code.push(lines[index]); index += 1; }
      /* An unterminated fence runs to the end of the entry. */
      if (index < lines.length) index += 1;
      blocks.push({ type: 'code', language, lines: code });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] });
      index += 1;
      continue;
    }

    if (line.startsWith('> ')) {
      const quote = [];
      while (index < lines.length && lines[index].startsWith('> ')) { quote.push(lines[index].slice(2)); index += 1; }
      blocks.push({ type: 'quote', lines: quote });
      continue;
    }

    if (BULLET_ITEM.test(line)) {
      const items = [];
      while (index < lines.length && BULLET_ITEM.test(lines[index])) {
        items.push(lines[index].replace(BULLET_ITEM, ''));
        index += 1;
      }
      blocks.push({ type: 'bullets', items });
      continue;
    }

    if (ORDERED_ITEM.test(line)) {
      const items = [];
      while (index < lines.length && ORDERED_ITEM.test(lines[index])) {
        items.push(lines[index].replace(ORDERED_ITEM, ''));
        index += 1;
      }
      blocks.push({ type: 'ordered', items });
      continue;
    }

    const paragraph = [];
    while (index < lines.length && lines[index].trim() && !BLOCK_START.test(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push({ type: 'paragraph', lines: paragraph });
  }

  return blocks;
}

/* ----------------------------------------------------------------- render */

/** Inline parts as nodes. */
function inlineNodes(text) {
  return inlineParts(text).map((part) => {
    if (part.type === 'code') return h('code', {}, part.value);
    if (part.type === 'strong') return h('strong', {}, part.value);
    if (part.type === 'link') return h('a', { href: part.href, target: '_blank', rel: 'noreferrer' }, part.text);
    return part.value;
  });
}

function renderBlock(block) {
  switch (block.type) {
    case 'code': {
      const pre = h('pre', {}, h('code', {}, block.lines.join('\n')));
      if (block.language) pre.dataset.language = block.language;
      return pre;
    }
    case 'heading':
      return h(`h${block.level}`, {}, ...inlineNodes(block.text));
    case 'quote':
      return h('blockquote', {}, ...block.lines.map((line) => h('p', {}, ...inlineNodes(line))));
    case 'bullets':
      return h('ul', {}, ...block.items.map((item) => h('li', {}, ...inlineNodes(item))));
    case 'ordered':
      return h('ol', {}, ...block.items.map((item) => h('li', {}, ...inlineNodes(item))));
    default:
      return h('p', {}, ...block.lines.map((line, lineIndex) =>
        h('span', {}, ...inlineNodes(line), ...(lineIndex < block.lines.length - 1 ? [h('br')] : []))));
  }
}

/** Blocks as one wrapped node. */
export function renderBlocks(blocks, className = 'prose') {
  return h('div', { class: className }, ...blocks.map(renderBlock));
}

/** What callers use: text in, node out. */
export function renderMarkdown(value, className = 'prose') {
  return renderBlocks(parseBlocks(value), className);
}
