#!/usr/bin/env python3
"""Accomplishment Journal — a private, local-first record of completed work.

Run it with::

    python app.py

then open the printed address (a browser tab opens automatically; pass
``--no-browser`` to suppress that). The server binds to ``127.0.0.1`` by
default: everything stays on this machine.

Design notes
------------
* **No dependencies.** Standard library only (``http.server``, ``json``).
* **The browser owns the interface** — the same single-page behaviour as the
  original React app (keyboard shortcuts, preview, focus mode). It holds no
  rules about what a change means.
* **Python owns the rules.** The browser sends an *operation* — "record this
  entry", "delete this project" — and :mod:`journal` decides what that does to
  the journal. Nothing else can change it. The result is validated by
  :func:`tracker.validate_tracker_state` and persisted atomically to
  ``data/journal.json`` by :mod:`store`. Backup/restore and CSV export are
  handled here too, so a Python script can read or migrate your journal
  without a browser.
* **An unreadable journal is never overwritten.** If the file on disk stops
  being a readable journal, every read answers ``409`` instead of pretending
  the journal is empty, and every write is refused until the user explicitly
  moves the file aside with ``POST /api/journal/quarantine``.
"""

from __future__ import annotations

import argparse
import configparser
import json
import mimetypes
import os
import re
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import journal
import store
import tracker

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
DATA_DIR = os.path.join(BASE_DIR, "data")
DATA_FILE = os.path.join(DATA_DIR, "journal.json")

BACKUP_APP_NAME = "Accomplishment Journal"

# The journal file, its lock, and every rule about surviving a crash.
JOURNAL = store.JournalStore(DATA_FILE)

# Sent with every 409 so the browser can tell "your journal is unreadable"
# apart from an ordinary validation complaint and offer the recovery action.
UNREADABLE_CODE = "journal-unreadable"

# Where this journal's published share page lives. Only the local build needs
# this: the hosted build is already sitting next to its own share.html.
SHARE_BASE = ""

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


def resolve_share_base(explicit: str | None, base_dir: str | os.PathLike[str] = BASE_DIR) -> str:
    """The share base to serve, given whatever ``--share-base`` was passed.

    An explicit empty string is a decision, not a missing value: it is how
    someone turns sharing off. Collapsing it into the derived URL with ``or``
    would silently re-enable the button they just asked to remove.
    """
    if explicit is not None:
        return explicit
    return pages_url_from_git_config(base_dir) or ""


def journal_payload(state: dict, **extra) -> dict:
    """A reply carrying the journal and any operation metadata."""
    return {"state": state, **extra}


def backup_payload(state: dict) -> dict:
    """The wrapped shape a JSON backup file uses (same as the original app)."""
    return {
        "app": BACKUP_APP_NAME,
        "exportedAt": datetime.now().astimezone().isoformat(),
        "data": state,
    }


def unwrap_backup(candidate) -> dict:
    """Accept either the wrapped backup file or a bare journal state."""
    if isinstance(candidate, dict) and "data" in candidate:
        return candidate["data"]
    return candidate


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    server_version = "AccomplishmentJournal/3.0"

    # Quieter default logging; one line per request at WARNING-level detail.
    def log_message(self, fmt: str, *args) -> None:  # noqa: N802 - stdlib name
        print(f"  {self.address_string()} - {fmt % args}")

    # ---- plumbing ---------------------------------------------------------

    def _send(self, code: int, body: bytes, content_type: str, extra_headers: list[tuple[str, str]] | None = None) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for name, value in extra_headers or []:
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, code: int, payload: dict, extra_headers: list[tuple[str, str]] | None = None) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self._send(code, body, "application/json; charset=utf-8", extra_headers)

    def _send_file_download(self, filename: str, body: bytes, content_type: str) -> None:
        self._send(
            200,
            body,
            content_type,
            [("Content-Disposition", f'attachment; filename="{filename}"')],
        )

    def _read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        return json.loads(raw.decode("utf-8"))

    def _error(self, code: int, message: str) -> None:
        self._send_json(code, {"error": message})

    def _conflict(self, reason: str) -> None:
        """Answer a route that cannot proceed because the journal is unreadable."""
        self._send_json(
            409,
            {
                "error": "This journal could not be read, so nothing has been changed.",
                "code": UNREADABLE_CODE,
                "reason": reason,
            },
        )

    # ---- journal access ---------------------------------------------------

    def _current_state(self) -> dict | None:
        """State for a read-only route, or ``None`` once a 409 has been sent.

        A missing journal is an empty one; an unreadable journal is a refusal.
        Collapsing those two was the bug this seam exists to prevent.
        """
        outcome = JOURNAL.read()
        if isinstance(outcome, store.Unreadable):
            self._conflict(outcome.reason)
            return None
        if isinstance(outcome, store.Missing):
            return tracker.empty_tracker_state()
        return outcome.state

    def _save(self, state: dict) -> bool:
        """Persist state, or answer 409 and report that nothing was written."""
        try:
            JOURNAL.write(state)
        except store.JournalLocked as error:
            self._conflict(error.reason)
            return False
        return True

    # ---- routes -----------------------------------------------------------

    def do_GET(self) -> None:  # noqa: N802 - stdlib name
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/":
            self._serve_static("index.html")
            return
        if path.startswith("/static/"):
            self._serve_static(path[len("/static/"):])
            return
        # The page uses relative asset URLs so the same files also work from
        # a GitHub Pages project subpath, and share.html sits at the root
        # there too.
        if path.count("/") == 1 and path.rsplit(".", 1)[-1] in {"css", "js", "html"}:
            self._serve_static(path[1:])
            return
        if path == "/healthz":
            self._send_json(200, {"ok": True})
            return
        if path == "/api/config":
            self._send_json(200, {"shareBase": SHARE_BASE})
            return
        if path == "/api/state":
            state = self._current_state()
            if state is None:
                return
            self._send_json(200, journal_payload(state))
            return
        if path == "/api/export/backup":
            state = self._current_state()
            if state is None:
                return
            body = json.dumps(backup_payload(state), ensure_ascii=False, indent=2).encode("utf-8")
            filename = f"accomplishment-journal-backup-{tracker.to_local_date_input()}.json"
            self._send_file_download(filename, body, "application/json; charset=utf-8")
            return
        if path == "/api/export/csv":
            self._export_csv(parse_qs(parsed.query))
            return

        self._error(404, "Not found.")

    def do_POST(self) -> None:  # noqa: N802 - stdlib name
        path = urlparse(self.path).path
        if path == "/api/op":
            self._apply_operation()
            return
        if path == "/api/journal/quarantine":
            self._quarantine()
            return
        if path != "/api/import/backup":
            self._error(404, "Not found.")
            return
        try:
            candidate = self._read_json()
            state = tracker.validate_tracker_state(unwrap_backup(candidate))
        except (ValueError, tracker.BackupError) as error:
            self._error(400, str(error))
            return
        if self._save(state):
            self._send_json(200, journal_payload(state, ok=True))

    # ---- helpers ------------------------------------------------------------

    def _apply_operation(self) -> None:
        """Run one named operation. The rules for what it does live in :mod:`journal`.

        Read, apply, and write happen inside a single :meth:`store.JournalStore.update`,
        so two tabs saving at the same moment queue up instead of overwriting
        each other's change.
        """
        try:
            operation = self._read_json()
        except ValueError:
            self._error(400, "That request could not be read.")
            return

        created_id = None

        def change(state: dict) -> dict:
            nonlocal created_id
            applied = journal.apply(state, operation)
            created_id = applied.created_id
            return applied.state

        try:
            state = JOURNAL.update(change)
        except (journal.OperationError, tracker.BackupError) as error:
            self._error(400, str(error))
            return
        except store.JournalLocked as error:
            self._conflict(error.reason)
            return
        self._send_json(200, journal_payload(state, ok=True, createdId=created_id))

    def _quarantine(self) -> None:
        """Move an unreadable journal aside — the one way out of a refusal.

        The file is renamed, never deleted, and only ever from here: nothing
        the app does on its own touches it.
        """
        try:
            moved_to = JOURNAL.quarantine()
        except ValueError as error:
            self._error(409, str(error))
            return
        except OSError as error:
            self._error(500, f"The journal could not be moved aside ({error.strerror or error}).")
            return
        self._send_json(
            200,
            journal_payload(tracker.empty_tracker_state(), ok=True, movedTo=moved_to),
        )

    def _serve_static(self, name: str) -> None:
        # Resolve inside STATIC_DIR only — never escape the folder.
        full_path = os.path.normpath(os.path.join(STATIC_DIR, name))
        if not full_path.startswith(STATIC_DIR + os.sep) or not os.path.isfile(full_path):
            self._error(404, "Not found.")
            return
        mime, _ = mimetypes.guess_type(full_path)
        if mime is None:
            mime = "application/octet-stream"
        with open(full_path, "rb") as handle:
            self._send(200, handle.read(), f"{mime}; charset=utf-8")

    def _export_csv(self, query: dict[str, list[str]]) -> None:
        """A pipe. What a CSV export *is* lives in :func:`tracker.export_project_log`."""
        state = self._current_state()
        if state is None:
            return
        try:
            filename, body = tracker.export_project_log(state, (query.get("project") or [""])[0])
        except tracker.UnknownProject:
            self._error(404, "Unknown project.")
            return
        self._send_file_download(filename, body, "text/csv;charset=utf-8")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Accomplishment Journal — a private record of completed work.")
    parser.add_argument("--host", default="127.0.0.1", help="Interface to bind (default: 127.0.0.1, local only).")
    parser.add_argument("--port", type=int, default=3000, help="Port to listen on (default: 3000).")
    parser.add_argument("--no-browser", action="store_true", help="Do not open a browser tab on start.")
    parser.add_argument(
        "--share-base",
        default=None,
        help="URL of the published share page (default: derived from the git origin, if it is a GitHub remote).",
    )
    args = parser.parse_args(argv)

    global SHARE_BASE
    SHARE_BASE = resolve_share_base(args.share_base)

    ThreadingHTTPServer.daemon_threads = True
    try:
        server = ThreadingHTTPServer((args.host, args.port), Handler)
    except OSError as error:
        print(f"Could not listen on {args.host}:{args.port}: {error.strerror or error}")
        if "address already in use" in str(error).lower() or "ADDRINUSE" in str(error):
            print("Is another copy of the journal already running? Try --port 3001.")
        return 1

    url = f"http://{args.host}:{args.port}"
    print("Accomplishment Journal")
    print(f"  Listening: {url}")
    print(f"  Data file: {os.path.relpath(DATA_FILE, os.getcwd())}")
    print(f"  Share base: {SHARE_BASE or 'not set — pass --share-base to enable sharing'}")
    print("  Ctrl+C to stop.")
    if not args.no_browser:
        webbrowser.open(url)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
