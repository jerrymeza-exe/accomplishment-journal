"""Tests for the Project Journal data layer (``tracker.py``).

Run from the project root:

    python -m tests.test_tracker
"""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

# Make the project root importable no matter where this is run from.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

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


def expect_error(name: str, payload, expected_message: str) -> None:
    try:
        tracker.validate_tracker_state(payload)
    except tracker.BackupError as error:
        check(name, str(error) == expected_message, f"(got: {error})")
    else:
        check(name, False, "(no error raised)")


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
                "tags": ["one", "two"],
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
                "markdown": "Did the thing and documented what changed.",
                "createdAt": "2026-01-05T10:00:00.000Z",
                "updatedAt": "2026-01-05T10:00:00.000Z",
            }
        ],
    }


def sample_v1() -> dict:
    return {
        "version": 1,
        "projects": [
            {
                "id": "project-a",
                "name": "Alpha",
                "description": "",
                "status": "Complete",
                "startedOn": "2025-03-01",
                "tags": [],
                "updatedAt": "2025-04-01",
            }
        ],
        "achievements": [
            {
                "id": "entry-1",
                "projectId": "project-a",
                "title": "Shipped it",
                "date": "2025-03-20",
                "category": "Delivery",
                "description": "Delivered the core feature set.",
                "impact": "Cut the release cycle in half.",
                "skills": ["Python", "Review"],
                "notes": "Coordinated with two teams.",
                "createdAt": "2025-03-20T09:00:00.000Z",
                "updatedAt": "2025-03-20T09:00:00.000Z",
            }
        ],
    }


def sample_v2() -> dict:
    """The previous Markdown schema, including its now-retired status field."""
    state = sample_v3()
    state["version"] = 2
    state["projects"][0]["status"] = "Complete"
    state["achievements"][0]["markdown"] = "- [x] Did the thing\n- [ ] More to do"
    return state


# ------------------------------------------------------------------ tests

def test_empty_state() -> None:
    state = tracker.empty_tracker_state()
    check("empty state shape", state == {"version": 3, "projects": [], "achievements": []}, repr(state))
    check("empty state validates", tracker.validate_tracker_state(state) == state)
    check("no completion calculator remains", not hasattr(tracker, "checklist_progress"))
    check("no progress derivation remains", not hasattr(tracker, "derive"))


def test_create_id() -> None:
    one, two = tracker.create_id("project"), tracker.create_id("project")
    check("create id prefix", one.startswith("project-") and two.startswith("project-"), one)
    check("create id unique", one != two)


def test_dates() -> None:
    check("local date input", tracker.to_local_date_input(datetime(2026, 9, 1)) == "2026-09-01")

    # Shape alone is not enough: a day that does not exist used to validate,
    # reach storage, and be rendered by the interface as a rolled-over date.
    check("real day", tracker.is_calendar_date("2026-08-30"))
    check("leap day in a leap year", tracker.is_calendar_date("2024-02-29"))
    check("no leap day otherwise", not tracker.is_calendar_date("2026-02-29"))
    check("month 13", not tracker.is_calendar_date("2026-13-01"))
    check("day 45", not tracker.is_calendar_date("2026-12-45"))
    check("day 00", not tracker.is_calendar_date("2026-12-00"))
    check("wrong shape", not tracker.is_calendar_date("2026-8-30"))
    check("empty", not tracker.is_calendar_date(""))
    check("not a date at all", not tracker.is_calendar_date("yesterday"))


def test_impossible_dates_are_refused() -> None:
    for field, label in (("startedOn", "project start date"), ):
        payload = sample_v3()
        payload["projects"][0][field] = "2026-13-45"
        expect_error(f"backup rejects an impossible {label}", payload,
                     f"Backup has an invalid {label}.")
    payload = sample_v3()
    payload["achievements"][0]["date"] = "2026-02-30"
    expect_error("backup rejects an impossible accomplishment date", payload,
                 "Backup has an invalid accomplishment date.")


def test_validate_v3() -> None:
    state = sample_v3()
    out = tracker.validate_tracker_state(state)
    check("v3 round trip", out == state)

    expect_error("rejects non-dict", "hello", "This is not a compatible Accomplishment Journal backup.")
    expect_error("rejects unknown version", {"version": 4, "projects": [], "achievements": []},
                 "This backup was made by an incompatible journal version.")
    expect_error("rejects missing version", {"projects": [], "achievements": []},
                 "This backup was made by an incompatible journal version.")
    expect_error("rejects missing projects", {"version": 3, "achievements": []},
                 "This is not a compatible Accomplishment Journal backup.")

    bad_date = sample_v3()
    bad_date["achievements"][0]["date"] = "Jan 5 2026"
    expect_error("rejects bad date", bad_date, "Backup has an invalid accomplishment date.")

    dup = sample_v3()
    dup["achievements"].append(dict(dup["achievements"][0]))
    expect_error("rejects duplicate entry ids", dup, "Backup includes duplicate accomplishment IDs.")

    orphan = sample_v3()
    orphan["achievements"][0]["projectId"] = "project-missing"
    expect_error("rejects orphan entry", orphan, "Backup includes an accomplishment with a missing project.")

    tags = sample_v3()
    tags["projects"][0]["tags"] = [" a ", "a", 5]
    expect_error("rejects non-string tags", tags, "Backup has invalid project tags.")

    dedup = sample_v3()
    dedup["projects"][0]["tags"] = [" a ", "a", "b"]
    out = tracker.validate_tracker_state(dedup)
    check("tags dedupe + trim", out["projects"][0]["tags"] == ["a", "b"], repr(out["projects"][0]["tags"]))


def test_migrate_legacy() -> None:
    v2 = sample_v2()
    original_markdown = v2["achievements"][0]["markdown"]
    migrated_v2 = tracker.validate_tracker_state(v2)
    check("v2 -> v3 version", migrated_v2["version"] == 3)
    check("v2 status is discarded", "status" not in migrated_v2["projects"][0], repr(migrated_v2["projects"][0]))
    check("v2 writing is preserved", migrated_v2["achievements"][0]["markdown"] == original_markdown)

    out = tracker.validate_tracker_state(sample_v1())
    check("v1 -> v3 version", out["version"] == 3)
    check("v1 status is discarded", "status" not in out["projects"][0], repr(out["projects"][0]))
    entry = out["achievements"][0]
    check("v1 category -> milestone", entry["milestone"] == "Delivery", entry["milestone"])
    markdown = entry["markdown"]
    check("v1 markdown description", markdown.startswith("Delivered the core feature set."), markdown)
    check("v1 markdown impact", "**Impact**\n\nCut the release cycle in half." in markdown, markdown)
    check("v1 markdown skills", "- Tools / skills: Python, Review" in markdown, markdown)
    check("v1 markdown notes", "> Coordinated with two teams." in markdown, markdown)

    no_category = sample_v1()
    no_category["achievements"][0]["category"] = ""
    out = tracker.validate_tracker_state(no_category)
    check("v1 empty category -> General", out["achievements"][0]["milestone"] == "General")

    expect_error("v1 rejects missing description", {
        "version": 1,
        "projects": sample_v1()["projects"],
        "achievements": [{k: v for k, v in sample_v1()["achievements"][0].items() if k != "description"}],
    }, "Backup has an invalid achievement description.")


def _export_state() -> dict:
    """Two projects, so an export has something to leave out."""
    return {
        "version": 3,
        "projects": [
            {"id": "p1", "name": "My Great Project!", "description": "",
             "startedOn": "2026-01-01", "tags": [], "updatedAt": "2026-01-01T00:00:00.000Z"},
            {"id": "p2", "name": "###", "description": "",
             "startedOn": "2026-01-01", "tags": [], "updatedAt": "2026-01-01T00:00:00.000Z"},
        ],
        "achievements": [
            {"id": "a1", "projectId": "p1", "title": 'Say "hi"', "date": "2026-01-05",
             "milestone": "", "markdown": "line1\r\nline2",
             "createdAt": "2026-01-05T00:00:00.000Z", "updatedAt": "2026-01-05T00:00:00.000Z"},
            {"id": "a2", "projectId": "p2", "title": "Other", "date": "2026-01-06",
             "milestone": "Phase 1", "markdown": "kept out",
             "createdAt": "2026-01-06T00:00:00.000Z", "updatedAt": "2026-01-06T00:00:00.000Z"},
        ],
    }


def test_export_project_log() -> None:
    filename, body = tracker.export_project_log(_export_state(), "p1")
    csv_text = body.decode("utf-8")

    # Exact bytes: bare header row, CRLF between rows and none at the end, all
    # data cells quoted, quotes doubled. (The markdown cell contains a literal
    # CRLF, which is legal inside a quoted field.)
    expected = 'project,date,milestone,title,markdown\r\n"My Great Project!","2026-01-05","","Say ""hi""","line1\r\nline2"'
    check("export exact bytes", csv_text == expected, repr(csv_text))
    check("export names the file", filename == "my-great-project-log.csv", filename)

    import csv as _csv, io as _io
    parsed = list(_csv.reader(_io.StringIO(csv_text)))
    check("export round-trips", parsed == [
        ["project", "date", "milestone", "title", "markdown"],
        ["My Great Project!", "2026-01-05", "", 'Say "hi"', "line1\r\nline2"],
    ], repr(parsed))
    check("export leaves other projects out", "kept out" not in csv_text)


def test_export_edges() -> None:
    state = _export_state()

    # A project with no entries is a header row, not an error.
    empty = {**state, "achievements": []}
    _, body = tracker.export_project_log(empty, "p1")
    check("export of an empty log", body == b"project,date,milestone,title,markdown", repr(body))

    # A name with nothing sluggable in it still produces a usable filename.
    filename, _ = tracker.export_project_log(state, "p2")
    check("export falls back to a plain slug", filename == "project-log.csv", filename)

    try:
        tracker.export_project_log(state, "nope")
    except tracker.UnknownProject:
        check("export refuses an unknown project", True)
    else:
        check("export refuses an unknown project", False, "(no error raised)")


def main() -> int:
    print("tracker.py tests\n")
    for test in (
        test_empty_state,
        test_create_id,
        test_dates,
        test_impossible_dates_are_refused,
        test_validate_v3,
        test_migrate_legacy,
        test_export_project_log,
        test_export_edges,
    ):
        print(f"{test.__name__}")
        test()
    print(f"\n{PASS} passed, {FAIL} failed")
    return 1 if FAIL else 0


if __name__ == "__main__":
    raise SystemExit(main())
