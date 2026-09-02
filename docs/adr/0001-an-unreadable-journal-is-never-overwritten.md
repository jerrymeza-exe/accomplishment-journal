# An unreadable journal is never overwritten

A journal file that exists but cannot be read is treated as a distinct state
from one that was never written, and the app refuses every write while it
lasts. Reading never repairs, renames, or replaces anything; the only way out
is `POST /api/journal/quarantine`, which the person using the app has to ask
for and which renames the file rather than deleting it.

We chose this because the obvious alternative — catching the read failure and
carrying on with an empty journal, which is what the app did before — turns one
damaged file into total data loss: the app looks empty, the user makes an edit
to see whether their work is really gone, and that edit is atomically written
over the file that still held everything.

## Considered options

**Start empty on any read failure** (the original behaviour). Simple, never
crashes on boot, and silently destroys the journal on the next save.

**Quarantine automatically during the read.** Recovers on its own, but it means
loading a page renames a user's file. A read that has side effects is a bad
thing to reach for when the file is already in a state we do not understand.

**Refuse writes, quarantine only on request.** Chosen. The damaged file survives
untouched for as long as the user wants to try to recover it by hand, the app
stays usable, and exactly one code path renames anything.

## Consequences

Restoring a backup over an unreadable journal is two steps, not one: the import
route refuses like every other write until the file has been quarantined. That
is deliberate — it keeps the "only one thing renames the journal, and only when
asked" rule intact — but it is the part most likely to feel like friction, and
the place to look first if this decision is ever revisited.
