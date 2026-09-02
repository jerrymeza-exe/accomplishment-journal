# Accomplishment Journal

A private, local-first journal for recording completed work. Projects keep
related entries together by role, client, initiative, or any other context,
while each entry captures a dated result, contribution, decision, or milestone
in a polished Markdown-style writer.

The product is intentionally a journal rather than a planning tool: it has no
completion targets, workflow stages, or performance scoring.

## What it does

- Create, edit, and delete projects with context, dates, and tags.
- Record accomplishment entries with headings, lists, links, code, and notes.
- Preview formatted writing live or switch to a distraction-free editor.
- Browse entries by date or milestone and reorder the journal when useful.
- Export one project as CSV or back up the complete journal as JSON.
- Keep everything on this machine in `data/journal.json` when using Python.
- Use the hosted GitHub Pages version from any phone or computer; its records
  stay in that browser's local storage and can be moved with Backup/Restore.

## Use the hosted app

The `main` branch publishes the contents of `static/` with GitHub Pages through
the workflow in `.github/workflows/pages.yml`. No journal entries are published
to GitHub: each browser stores its own copy locally. Use **Backup** on one device
and **Restore** on another when you want to transfer your journal.

Older version 1 and version 2 backups still import. Their writing, dates,
milestones, tags, and project details are preserved and normalized into the
current version 3 journal format.

## Run locally

1. Install Python 3.10 or later. No third-party packages are required.
2. Run:

   ```powershell
   python app.py
   ```

3. The journal opens at `http://127.0.0.1:3000`.

Useful flags:

```powershell
python app.py --port 3001
python app.py --no-browser
python app.py --host 0.0.0.0
```

The default address is local to this machine. Keep sensitive, proprietary,
classified, or export-controlled information out of the journal.

## Keyboard

| Key | Action |
| --- | --- |
| `N` | New accomplishment entry |
| `P` | New project |
| `/` | Focus the project filter |
| `Ctrl`/`Cmd` + `Enter` | Save the open entry |
| `Esc` | Close the writer or project sheet |

## Data and compatibility

The server validates and writes journal changes atomically. An unreadable
journal is never overwritten: writing remains locked until the app moves the
unreadable file aside under a recoverable name.

The version 3 format retains the original `projects` and `projectId` JSON keys
so earlier journal files and integrations remain readable.

## HTTP API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/state` | Read the complete journal |
| `POST` | `/api/op` | Apply one journal change |
| `GET` | `/api/export/backup` | Download a JSON backup |
| `POST` | `/api/import/backup` | Validate and restore a backup |
| `GET` | `/api/export/csv?project=<id>` | Download one project as CSV |
| `POST` | `/api/journal/quarantine` | Move an unreadable journal aside |
| `GET` | `/healthz` | Check that the local server is running |

Supported operations are `create_project`, `update_project`, `delete_project`,
`record_entry`, `update_entry`, `delete_entry`, and `move_entry`.

## Project layout

```text
app.py              Local HTTP server and routes
journal.py          Rules for every journal change
store.py            Atomic file storage and recovery
tracker.py          Validation, migration, dates, and CSV export
static/index.html   Page shell and forms
static/app.js       Interface rendering and interactions
static/view.js      Search, grouping, numbering, and counts
static/markdown.js  Safe Markdown-style parser and renderer
static/app.css      Visual design system
tests/              Python and browser-logic tests
```

## Tests

```powershell
python -m tests.test_tracker
python -m tests.test_store
python -m tests.test_journal
node --test
```

Node is used only for development tests. Running the journal requires only
Python and its standard library.
