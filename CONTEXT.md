# Accomplishment Journal

A local-first record of completed work, kept on one person’s own machine.

## The record

**Journal**  
The complete personal record: every project and every entry.

**Project**  
A body of related accomplishments—for example a role, client, initiative, or
area of responsibility.

**Entry**  
One dated, Markdown-written account of a result, contribution, decision, note,
or milestone.

**Accomplishment log**  
A project’s entries, read in order.

**Milestone**  
An optional label used to group related entries independently of their dates.

**Tag**  
A free-text label on a project. Tags help people find related projects;
they do not score or evaluate the work.

**Backup**  
A portable JSON file containing the complete journal.

**Snapshot**  
A frozen, self-contained copy of one project's accomplishment log, encoded
into a link. A snapshot is made for one named person. It cannot be changed or
withdrawn once it is sent, and the journal it came from can change afterwards
without changing it.

## Changing a journal

**Operation**  
One named change to the journal, such as recording an entry, editing a
project, or moving an entry within its log.

## Durability

**Journal store**  
The owner of the journal file on disk. It reads and replaces that file
atomically.

**Unreadable journal**  
A journal file that cannot be safely interpreted. This is different from a new,
empty journal.

**Quarantine**  
Moving an unreadable journal aside under a recoverable name so a new journal can
be started without destroying the old file.
