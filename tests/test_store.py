"""Tests for the journal store (``store.py``).

Run from the project root:

    python -m tests.test_store

Every test builds a store over a fresh temporary directory, so nothing here
touches ``data/journal.json``.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from datetime import datetime
from pathlib import Path

# Make the project root importable no matter where this is run from.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import store  # noqa: E402
import tracker  # noqa: E402

PASS = 0
FAIL = 0


def check(name: str, condition: bool, detail: str = "") -> None:
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  ok    {name}")
    else:
        FAIL += 1
        print(f"  FAIL  {name}  {detail}")


# ---------------------------------------------------------------- fixtures

def sample_v3() -> dict:
    return {
        "version": 3,
        "projects": [
            {
                "id": "project-a",
                "name": "Alpha",
                "description": "First project",
                "startedOn": "2026-01-05",
                "tags": ["one"],
                "updatedAt": "2026-01-06",
            }
        ],
        "achievements": [
            {
                "id": "entry-1",
                "projectId": "project-a",
                "title": "Kickoff",
                "date": "2026-01-05",
                "milestone": "Start",
                "markdown": "Did the thing",
                "createdAt": "2026-01-05T10:00:00.000Z",
                "updatedAt": "2026-01-05T10:00:00.000Z",
            }
        ],
    }


class Sandbox:
    """A temporary directory holding one journal path."""

    def __init__(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = os.path.join(self._tmp.name, "data")
        self.path = os.path.join(self.dir, "journal.json")

    def store(self) -> store.JournalStore:
        return store.JournalStore(self.path)

    def put(self, text: str) -> None:
        os.makedirs(self.dir, exist_ok=True)
        with open(self.path, "w", encoding="utf-8") as handle:
            handle.write(text)

    def raw(self) -> str:
        with open(self.path, "r", encoding="utf-8") as handle:
            return handle.read()

    def names(self) -> list[str]:
        return sorted(os.listdir(self.dir)) if os.path.isdir(self.dir) else []

    def close(self) -> None:
        self._tmp.cleanup()


# ------------------------------------------------------------------- tests

def test_missing() -> None:
    """A journal nobody has written yet is Missing — not Unreadable, not empty."""
    box = Sandbox()
    try:
        # The data directory does not exist at all yet.
        outcome = box.store().read()
        check("missing dir reads Missing", isinstance(outcome, store.Missing), repr(outcome))

        os.makedirs(box.dir)
        outcome = box.store().read()
        check("missing file reads Missing", isinstance(outcome, store.Missing), repr(outcome))
    finally:
        box.close()


def test_write_then_read() -> None:
    box = Sandbox()
    try:
        journal = box.store()
        journal.write(sample_v3())
        check("write creates the data directory", os.path.isdir(box.dir))
        check("write leaves no temp files", box.names() == ["journal.json"], repr(box.names()))

        outcome = journal.read()
        check("write then read is Loaded", isinstance(outcome, store.Loaded), repr(outcome))
        check("round-trips the state", outcome.state == sample_v3(), repr(outcome.state))
    finally:
        box.close()


def test_loaded_and_migrated() -> None:
    box = Sandbox()
    try:
        legacy_v2 = sample_v3()
        legacy_v2["version"] = 2
        legacy_v2["projects"][0]["status"] = "Archived"
        box.put(json.dumps(legacy_v2))
        outcome = box.store().read()
        check("valid v2 file is Loaded", isinstance(outcome, store.Loaded), repr(outcome))
        if isinstance(outcome, store.Loaded):
            check("v2 file is migrated to v3", outcome.state["version"] == 3)
            check("the retired status is discarded", "status" not in outcome.state["projects"][0])

        legacy = {
            "version": 1,
            "projects": legacy_v2["projects"],
            "achievements": [
                {
                    "id": "entry-1",
                    "projectId": "project-a",
                    "title": "Kickoff",
                    "date": "2026-01-05",
                    "category": "Start",
                    "description": "Did the thing",
                    "impact": "It worked",
                    "skills": ["python"],
                    "notes": "",
                    "createdAt": "2026-01-05T10:00:00.000Z",
                    "updatedAt": "2026-01-05T10:00:00.000Z",
                }
            ],
        }
        box.put(json.dumps(legacy))
        outcome = box.store().read()
        check("v1 file is Loaded", isinstance(outcome, store.Loaded), repr(outcome))
        if isinstance(outcome, store.Loaded):
            check("v1 file is migrated to v3", outcome.state["version"] == 3)
            check(
                "v1 achievement folds into markdown",
                "**Impact**" in outcome.state["achievements"][0]["markdown"],
                repr(outcome.state["achievements"][0]["markdown"]),
            )
    finally:
        box.close()


def test_unreadable() -> None:
    """Both ways a journal can fail to load, each with its own reason."""
    box = Sandbox()
    try:
        box.put("{ this is not json")
        outcome = box.store().read()
        check("bad JSON is Unreadable", isinstance(outcome, store.Unreadable), repr(outcome))
        check("bad JSON says so", "not valid JSON" in getattr(outcome, "reason", ""), repr(outcome))

        broken = sample_v3()
        broken["projects"][0]["startedOn"] = "2026-13-45"
        box.put(json.dumps(broken))
        outcome = box.store().read()
        check("invalid journal is Unreadable", isinstance(outcome, store.Unreadable), repr(outcome))
        check(
            "invalid journal keeps the validation message",
            getattr(outcome, "reason", "") == "Backup has an invalid project start date.",
            repr(outcome),
        )
    finally:
        box.close()


def test_read_has_no_side_effects() -> None:
    box = Sandbox()
    try:
        box.put("{ this is not json")
        journal = box.store()
        journal.read()
        journal.read()
        check("reading does not rename or delete", box.names() == ["journal.json"], repr(box.names()))
        check("reading does not rewrite", box.raw() == "{ this is not json", repr(box.raw()))
    finally:
        box.close()


def test_write_refused_while_unreadable() -> None:
    """The bug this seam exists to prevent: an unreadable journal overwritten."""
    box = Sandbox()
    try:
        box.put("{ this is not json")
        journal = box.store()
        try:
            journal.write(tracker.empty_tracker_state())
        except store.JournalLocked as error:
            check("write raises JournalLocked", True)
            check("JournalLocked carries the reason", "not valid JSON" in error.reason, error.reason)
        else:
            check("write raises JournalLocked", False, "(no error raised)")
        check("the unreadable file is untouched", box.raw() == "{ this is not json", repr(box.raw()))
    finally:
        box.close()


def test_write_rejects_invalid_state() -> None:
    box = Sandbox()
    try:
        journal = box.store()
        journal.write(sample_v3())
        before = box.raw()
        try:
            journal.write({"version": 3, "projects": "nope", "achievements": []})
        except tracker.BackupError:
            check("write rejects an invalid state", True)
        else:
            check("write rejects an invalid state", False, "(no error raised)")
        check("a rejected write leaves the file alone", box.raw() == before)
    finally:
        box.close()


def test_update() -> None:
    """Read-modify-write as one step, so two writers cannot interleave."""
    box = Sandbox()
    try:
        journal = box.store()

        seen = []
        written = journal.update(lambda state: seen.append(state) or sample_v3())
        check("update starts from empty when nothing is written", seen[0] == tracker.empty_tracker_state(), repr(seen[0]))
        check("update returns what it wrote", written == sample_v3())

        renamed = dict(sample_v3())
        renamed["projects"] = [{**renamed["projects"][0], "name": "Renamed"}]
        journal.update(lambda state: renamed)
        outcome = journal.read()
        check("update sees the previous write", isinstance(outcome, store.Loaded))
        check("and replaces it", outcome.state["projects"][0]["name"] == "Renamed")
    finally:
        box.close()


def test_update_refuses_and_propagates() -> None:
    box = Sandbox()
    try:
        journal = box.store()
        journal.write(sample_v3())
        before = box.raw()

        class Refused(Exception):
            pass

        def explode(state):
            raise Refused()

        try:
            journal.update(explode)
        except Refused:
            check("update propagates what the change raises", True)
        else:
            check("update propagates what the change raises", False, "(no error raised)")
        check("and writes nothing when it does", box.raw() == before)

        box.put("{ this is not json")
        try:
            journal.update(lambda state: sample_v3())
        except store.JournalLocked:
            check("update refuses an unreadable journal", True)
        else:
            check("update refuses an unreadable journal", False, "(no error raised)")
        check("leaving the unreadable file alone", box.raw() == "{ this is not json")
    finally:
        box.close()


def test_quarantine() -> None:
    box = Sandbox()
    try:
        box.put("{ this is not json")
        journal = box.store()
        moved_to = journal.quarantine(datetime(2026, 9, 2, 17, 30, 5))
        check("quarantine names the new file", moved_to == "journal.unreadable-20260902-173005.json", repr(moved_to))
        check("the original path is free", not os.path.exists(box.path))
        check("the bad file is kept, not deleted", box.names() == [moved_to], repr(box.names()))
        with open(os.path.join(box.dir, moved_to), "r", encoding="utf-8") as handle:
            check("its contents survive", handle.read() == "{ this is not json")

        check("the journal now reads Missing", isinstance(journal.read(), store.Missing))
        journal.write(sample_v3())
        check("writing works again", isinstance(journal.read(), store.Loaded))
    finally:
        box.close()


def test_quarantine_refuses_a_readable_journal() -> None:
    """Recovery hatch, not a delete button."""
    box = Sandbox()
    try:
        journal = box.store()
        journal.write(sample_v3())
        try:
            journal.quarantine()
        except ValueError:
            check("quarantine refuses a readable journal", True)
        else:
            check("quarantine refuses a readable journal", False, "(no error raised)")
        check("the readable journal is still there", box.names() == ["journal.json"], repr(box.names()))

        empty = Sandbox()
        try:
            check("quarantine with no journal returns None", empty.store().quarantine() is None)
        finally:
            empty.close()
    finally:
        box.close()


def test_second_quarantine_does_not_clobber_the_first() -> None:
    box = Sandbox()
    try:
        journal = box.store()
        stamp = datetime(2026, 9, 2, 17, 30, 5)

        box.put("first broken file")
        first = journal.quarantine(stamp)
        box.put("second broken file")
        second = journal.quarantine(stamp)

        check("the same second gets a distinct name", first != second, f"{first} / {second}")
        check("both files are kept", len(box.names()) == 2, repr(box.names()))
    finally:
        box.close()


def main() -> int:
    print("store.py tests\n")
    for test in (
        test_missing,
        test_write_then_read,
        test_loaded_and_migrated,
        test_unreadable,
        test_read_has_no_side_effects,
        test_write_refused_while_unreadable,
        test_write_rejects_invalid_state,
        test_update,
        test_update_refuses_and_propagates,
        test_quarantine,
        test_quarantine_refuses_a_readable_journal,
        test_second_quarantine_does_not_clobber_the_first,
    ):
        print(f"{test.__name__}")
        test()
    print(f"\n{PASS} passed, {FAIL} failed")
    return 1 if FAIL else 0


if __name__ == "__main__":
    raise SystemExit(main())
