# The browser’s rules are testable too

The interface’s non-trivial transformations are separated from DOM plumbing so
Node’s built-in test runner can assert them as data:

- `static/markdown.js` parses the journal’s small, safe Markdown-style subset.
- `static/view.js` builds the rail and active project view, including search,
  grouping, sequence numbers, counts, and move availability.

`static/app.js` renders those results and connects user actions to the local
server. Node is a development dependency only; running the journal still needs
only Python and its standard library.

## Consequences

A contributor who changes formatting, grouping, searching, or numbering runs
`node --test`. The parser and view model remain small enough to test without a
browser DOM dependency.
