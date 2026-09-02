# Every journal rule has one implementation

Rules about journal integrity live in Python. Presentation-only behavior lives
in the browser. A rule is not duplicated across both sides.

Calendar validation is the clearest example: `tracker.is_calendar_date`
refuses impossible dates at both write boundaries, while `formatStamp` in
`static/view.js` only turns validated dates into readable labels.

This keeps saved entries trustworthy without making the interface wait for the
server whenever it filters, groups, or renders existing writing.

## Consequences

- Imports and journal changes pass through the same validation rules.
- The browser owns display formatting, search, grouping, and numbering.
- Server replies carry the journal itself plus operation metadata when needed.
- No calculated accomplishment score is stored or transported.
