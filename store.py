"""Durable storage for the Project Journal.

This module owns ``data/journal.json`` — every fact about how the journal
survives a crash, a half-written file, or a file that has stopped being a
journal at all. It is the only place in the app that renames or replaces that
file.

The interface is three named outcomes and two verbs:

* :meth:`JournalStore.read` returns :class:`Loaded`, :class:`Missing`, or
  :class:`Unreadable` — never "empty" as a stand-in for "broken".
* :meth:`JournalStore.write` persists a state atomically, and **refuses** when
  the journal on disk is unreadable, so an unreadable journal is never
  silently overwritten by whatever the UI happens to be holding.
* :meth:`JournalStore.quarantine` is the only escape from that refusal: it
  moves the unreadable file aside, under a name that says what it is, and lets
  writing resume. Nothing else in this module renames anything, and reading
  never has side effects.

Everything a state passes through here is validated by
:func:`tracker.validate_tracker_state`, so a ``Loaded`` state is always a valid
v3 journal and the file on disk always holds one.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable

import tracker


# ---------------------------------------------------------------------------
# Read outcomes
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Loaded:
    """A journal was read from disk and validated."""

    state: dict[str, Any]


@dataclass(frozen=True)
class Missing:
    """No journal has been written yet.

    A normal state for a local-first app on its first run — deliberately not
    the same value as :class:`Unreadable`, so callers cannot confuse "you have
    not written anything" with "your writing could not be read".
    """


@dataclass(frozen=True)
class Unreadable:
    """A journal file exists but could not be turned into state.

    ``reason`` is a short, user-facing sentence: either a JSON parse failure or
    the verbatim :class:`tracker.BackupError` message, so the app can say which
    of the two happened.
    """

    reason: str


JournalRead = Loaded | Missing | Unreadable


class JournalLocked(Exception):
    """Raised when a write is refused because the journal on disk is unreadable.

    The offending file is still on disk, untouched. Call
    :meth:`JournalStore.quarantine` to move it aside and unlock writing.
    """

    def __init__(self, reason: str) -> None:
        super().__init__(
            "The journal on disk could not be read, so it was not overwritten."
        )
        self.reason = reason


# ---------------------------------------------------------------------------
# The store
# ---------------------------------------------------------------------------

class JournalStore:
    """Owns one journal file: its reads, its atomic writes, and its lock.

    The path is a constructor argument rather than a module constant so tests
    can point a store at a temporary directory. Nothing is cached; every read
    goes to disk, which keeps read-your-writes correct and keeps the promise
    that an outside Python script reading ``journal.json`` sees the same thing
    the app does.
    """

    def __init__(self, path: str) -> None:
        self._path = path
        self._lock = threading.Lock()

    @property
    def path(self) -> str:
        return self._path

    # -- reading ------------------------------------------------------------

    def read(self) -> JournalRead:
        """Read the journal. Never raises, never writes, never renames."""
        with self._lock:
            return self._read_unlocked()

    def _read_unlocked(self) -> JournalRead:
        try:
            with open(self._path, "r", encoding="utf-8") as handle:
                raw = json.load(handle)
        except FileNotFoundError:
            return Missing()
        except OSError as error:
            return Unreadable(f"The journal file could not be opened ({error.strerror or error}).")
        except ValueError:
            return Unreadable("The journal file is not valid JSON.")

        try:
            return Loaded(tracker.validate_tracker_state(raw))
        except tracker.BackupError as error:
            return Unreadable(str(error))

    # -- writing ------------------------------------------------------------

    def write(self, state: dict[str, Any]) -> dict[str, Any]:
        """Validate ``state`` and persist it atomically. Returns what was written.

        Raises :class:`tracker.BackupError` if ``state`` is not a valid journal
        — the file on disk is left alone — and :class:`JournalLocked` if the
        journal already on disk is unreadable.
        """
        validated = tracker.validate_tracker_state(state)
        with self._lock:
            current = self._read_unlocked()
            if isinstance(current, Unreadable):
                raise JournalLocked(current.reason)
            self._write_unlocked(validated)
        return validated

    def update(self, change: Callable[[dict[str, Any]], dict[str, Any]]) -> dict[str, Any]:
        """Read, transform, and write as one step. Returns what was written.

        ``change`` receives the journal on disk — an empty one if nothing has
        been written yet — and returns its replacement. Holding the lock across
        the whole thing is what stops two writers from reading the same journal
        and each writing their own change over the other's.

        Raises :class:`JournalLocked` if the journal is unreadable. Anything
        ``change`` itself raises comes straight back out, with nothing written.
        """
        with self._lock:
            current = self._read_unlocked()
            if isinstance(current, Unreadable):
                raise JournalLocked(current.reason)
            state = current.state if isinstance(current, Loaded) else tracker.empty_tracker_state()
            updated = tracker.validate_tracker_state(change(state))
            self._write_unlocked(updated)
            return updated

    def _write_unlocked(self, state: dict[str, Any]) -> None:
        directory = os.path.dirname(self._path) or "."
        os.makedirs(directory, exist_ok=True)
        file_descriptor, tmp_path = tempfile.mkstemp(dir=directory, suffix=".tmp")
        try:
            with os.fdopen(file_descriptor, "w", encoding="utf-8") as handle:
                json.dump(state, handle, ensure_ascii=False, indent=2)
            os.replace(tmp_path, self._path)
        except BaseException:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise

    # -- recovery -----------------------------------------------------------

    def quarantine(self, now: datetime | None = None) -> str | None:
        """Move an unreadable journal aside so writing can resume.

        Returns the file name it was moved to, or ``None`` when there was no
        journal to move. Refuses (``ValueError``) when the journal reads fine —
        this is a recovery hatch, not a delete button.
        """
        with self._lock:
            current = self._read_unlocked()
            if isinstance(current, Loaded):
                raise ValueError("The journal reads fine; there is nothing to move aside.")
            if isinstance(current, Missing):
                return None

            stamp = (now or datetime.now()).strftime("%Y%m%d-%H%M%S")
            stem, suffix = os.path.splitext(self._path)
            target = f"{stem}.unreadable-{stamp}{suffix}"
            attempt = 2
            while os.path.exists(target):
                target = f"{stem}.unreadable-{stamp}-{attempt}{suffix}"
                attempt += 1
            os.replace(self._path, target)
            return os.path.basename(target)
