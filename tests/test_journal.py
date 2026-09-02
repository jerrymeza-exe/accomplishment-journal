"""Tests for the journal operations (``journal.py``).

Run from the project root:

    python -m tests.test_journal

Every rule here used to live in a DOM event handler, where none of it could be
asserted. The clock and the id factory are injected, so each test states the
whole journal it expects.
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

# Make the project root importable no matter where this is run from.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import journal  # noqa: E402
import tracker  # noqa: E402

PASS = 0
FAIL = 0

NOW = datetime(2026, 9, 2, 17, 30, 5, tzinfo=timezone.utc)
STAMP = "2026-09-02T17:30:05.000Z"
OLD = "2026-01-06T00:00:00.000Z"


def check(name: str, condition: bool, detail: str = "") -> None:
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  ok    {name}")
    else:
        FAIL += 1
        print(f"  FAIL  {name}  {detail}")


def expect_error(name: str, state: dict, operation: dict, expected_message: str) -> None:
    try:
        run(state, operation)
    except journal.OperationError as error:
        check(name, str(error) == expected_message, f"(got: {error})")
    else:
        check(name, False, "(no error raised)")


def run(state: dict, operation: dict, ids: list[str] | None = None) -> journal.Applied:
    """Apply an operation with a fixed clock and predictable ids."""
    supply = iter(ids or ["new-1", "new-2", "new-3"])
    return journal.apply(state, operation, now=NOW, new_id=lambda prefix: f"{prefix}-{next(supply)}")


# ---------------------------------------------------------------- fixtures

def project(project_id: str, name: str = "Alpha") -> dict:
    return {
        "id": project_id,
        "name": name,
        "description": "",
        "startedOn": "2026-01-05",
        "tags": [],
        "updatedAt": OLD,
    }


def entry(entry_id: str, project_id: str, title: str = "Kickoff") -> dict:
    return {
        "id": entry_id,
        "projectId": project_id,
        "title": title,
        "date": "2026-01-05",
        "milestone": "",
        "markdown": "Did the thing",
        "createdAt": OLD,
        "updatedAt": OLD,
    }


def journal_with(projects: list[dict], entries: list[dict]) -> dict:
    return {"version": 3, "projects": projects, "achievements": entries}


def base() -> dict:
    """Two projects; project-a has three entries, project-b has one between them."""
    return journal_with(
        [project("project-a"), project("project-b", name="Beta")],
        [
            entry("entry-1", "project-a", "First"),
            entry("entry-2", "project-b", "Other project"),
            entry("entry-3", "project-a", "Second"),
            entry("entry-4", "project-a", "Third"),
        ],
    )


# ------------------------------------------------------------------- tests

def test_unknown_operations() -> None:
    expect_error("unknown op name", base(), {"op": "drop_everything"}, "Unknown operation: 'drop_everything'.")
    expect_error("missing op name", base(), {"id": "project-a"}, "Unknown operation: None.")
    try:
        journal.apply(base(), ["not", "a", "dict"], now=NOW)
    except journal.OperationError as error:
        check("a non-operation is refused", str(error) == "That is not an operation.", str(error))
    else:
        check("a non-operation is refused", False, "(no error raised)")


def test_create_project() -> None:
    state = journal_with([], [])
    applied = run(state, {
        "op": "create_project",
        "name": "  Alpha  ",
        "description": " a project ",
        "startedOn": "2026-01-05",
        "tags": ["one", "two"],
    })
    created = applied.state["projects"][0]
    check("the new project is returned by id", applied.created_id == "project-new-1", applied.created_id)
    check("its id is the one that was minted", created["id"] == "project-new-1")
    check("the name is trimmed", created["name"] == "Alpha", repr(created["name"]))
    check("it is stamped with the clock", created["updatedAt"] == STAMP, created["updatedAt"])
    check("the original state is untouched", state["projects"] == [])

    expect_error(
        "a blank name is refused",
        journal_with([], []),
        {"op": "create_project", "name": "   ", "startedOn": "2026-01-05"},
        "Add a project name before saving.",
    )
    expect_error(
        "an unreadable date is refused",
        journal_with([], []),
        {"op": "create_project", "name": "Alpha", "startedOn": "5th Jan"},
        "That date could not be read.",
    )
    # Right shape, no such day. This used to be stored and then displayed as
    # a date that had rolled over into the following year.
    expect_error(
        "a day that does not exist is refused",
        journal_with([], []),
        {"op": "create_project", "name": "Alpha", "startedOn": "2026-13-45"},
        "That date could not be read.",
    )
    expect_error(
        "a leap day outside a leap year is refused",
        journal_with([], []),
        {"op": "create_project", "name": "Alpha", "startedOn": "2026-02-29"},
        "That date could not be read.",
    )


def test_update_project() -> None:
    applied = run(base(), {
        "op": "update_project",
        "id": "project-b",
        "name": "Beta renamed",
        "description": "",
        "startedOn": "2026-02-01",
        "tags": [],
    })
    changed = applied.state["projects"][1]
    untouched = applied.state["projects"][0]
    check("the named project changes", changed["name"] == "Beta renamed")
    check("its updatedAt moves", changed["updatedAt"] == STAMP)
    check("nothing creates an id", applied.created_id is None)
    check("the other project is left alone", untouched["updatedAt"] == OLD)
    expect_error(
        "an unknown project is refused",
        base(),
        {"op": "update_project", "id": "nope", "name": "X", "startedOn": "2026-01-05"},
        "That project is no longer in this journal.",
    )


def test_delete_project_cascades() -> None:
    """The rule that had no home: a project takes its log with it."""
    applied = run(base(), {"op": "delete_project", "id": "project-a"})
    check("the project is gone", [p["id"] for p in applied.state["projects"]] == ["project-b"])
    check(
        "its entries go with it",
        [e["id"] for e in applied.state["achievements"]] == ["entry-2"],
        [e["id"] for e in applied.state["achievements"]],
    )
    check("no orphan is left behind", all(
        e["projectId"] in {p["id"] for p in applied.state["projects"]} for e in applied.state["achievements"]
    ))
    expect_error(
        "deleting an unknown project is refused",
        base(),
        {"op": "delete_project", "id": "nope"},
        "That project is no longer in this journal.",
    )


def test_record_entry() -> None:
    applied = run(base(), {
        "op": "record_entry",
        "projectId": "project-b",
        "title": "  Shipped  ",
        "date": "2026-09-02",
        "milestone": " Launch ",
        "markdown": "  It went out.  ",
    })
    entries = applied.state["achievements"]
    check("the entry is returned by id", applied.created_id == "entry-new-1", applied.created_id)
    check("a new entry goes to the head of the log", entries[0]["id"] == "entry-new-1", [e["id"] for e in entries])
    check("its text is trimmed", entries[0]["title"] == "Shipped" and entries[0]["markdown"] == "It went out.")
    check("created and updated match on the way in", entries[0]["createdAt"] == STAMP == entries[0]["updatedAt"])
    check("writing an entry marks its project as updated",
          applied.state["projects"][1]["updatedAt"] == STAMP)
    check("other projects are not marked", applied.state["projects"][0]["updatedAt"] == OLD)

    expect_error(
        "an entry needs a body",
        base(),
        {"op": "record_entry", "projectId": "project-a", "title": "T", "date": "2026-09-02", "markdown": "   "},
        "Add a title and a short log entry before saving.",
    )
    expect_error(
        "an entry needs a project that exists",
        base(),
        {"op": "record_entry", "projectId": "nope", "title": "T", "date": "2026-09-02", "markdown": "B"},
        "That project is no longer in this journal.",
    )


def test_update_entry() -> None:
    applied = run(base(), {
        "op": "update_entry",
        "id": "entry-3",
        "projectId": "project-a",
        "title": "Second, revised",
        "date": "2026-01-07",
        "milestone": "",
        "markdown": "More detail",
    })
    entries = applied.state["achievements"]
    check("editing keeps the entry in place", [e["id"] for e in entries] == ["entry-1", "entry-2", "entry-3", "entry-4"])
    check("the fields change", entries[2]["title"] == "Second, revised")
    check("createdAt is preserved", entries[2]["createdAt"] == OLD)
    check("updatedAt moves", entries[2]["updatedAt"] == STAMP)
    check("editing an entry marks its project as updated", applied.state["projects"][0]["updatedAt"] == STAMP)

    moved = run(base(), {
        "op": "update_entry",
        "id": "entry-3",
        "projectId": "project-b",
        "title": "Moved across",
        "date": "2026-01-07",
        "milestone": "",
        "markdown": "Now on Beta",
    })
    check("an entry can move to another project", moved.state["achievements"][2]["projectId"] == "project-b")
    check("the project it landed in is marked", moved.state["projects"][1]["updatedAt"] == STAMP)
    check("the project it left is not", moved.state["projects"][0]["updatedAt"] == OLD)


def test_delete_entry() -> None:
    applied = run(base(), {"op": "delete_entry", "id": "entry-3"})
    check("the entry is gone", [e["id"] for e in applied.state["achievements"]] == ["entry-1", "entry-2", "entry-4"])
    check("deleting an entry does not mark the project", applied.state["projects"][0]["updatedAt"] == OLD)
    expect_error(
        "deleting an unknown entry is refused",
        base(),
        {"op": "delete_entry", "id": "nope"},
        "That entry is no longer in this journal.",
    )


def test_move_entry_stays_within_its_project() -> None:
    """entry-2 belongs to another project and sits between two of project-a's."""
    applied = run(base(), {"op": "move_entry", "id": "entry-1", "direction": 1})
    order = [e["id"] for e in applied.state["achievements"]]
    check("the entry swaps with its own next neighbour", order == ["entry-3", "entry-2", "entry-1", "entry-4"], order)
    check("the other project's entry keeps its slot", order[1] == "entry-2")

    back = run(applied.state, {"op": "move_entry", "id": "entry-1", "direction": -1})
    check("moving back restores the order", [e["id"] for e in back.state["achievements"]] ==
          ["entry-1", "entry-2", "entry-3", "entry-4"])


def test_move_entry_at_the_ends() -> None:
    top = run(base(), {"op": "move_entry", "id": "entry-1", "direction": -1})
    check("the first entry cannot move up", [e["id"] for e in top.state["achievements"]] ==
          ["entry-1", "entry-2", "entry-3", "entry-4"])
    bottom = run(base(), {"op": "move_entry", "id": "entry-4", "direction": 1})
    check("the last entry cannot move down", [e["id"] for e in bottom.state["achievements"]] ==
          ["entry-1", "entry-2", "entry-3", "entry-4"])
    check("a lone entry cannot move", [e["id"] for e in
          run(base(), {"op": "move_entry", "id": "entry-2", "direction": 1}).state["achievements"]] ==
          ["entry-1", "entry-2", "entry-3", "entry-4"])
    expect_error(
        "a nonsense direction is refused",
        base(),
        {"op": "move_entry", "id": "entry-1", "direction": 3},
        "An entry can only move up or down.",
    )


def test_results_are_valid_journals() -> None:
    """Whatever an operation produces has to survive validation on the way to disk."""
    state = journal_with([], [])
    state = run(state, {
        "op": "create_project", "name": "Alpha", "startedOn": "2026-01-05",
        "tags": [" one ", "one", ""],
    }).state
    project_id = state["projects"][0]["id"]
    state = run(state, {
        "op": "record_entry", "projectId": project_id, "title": "T",
        "date": "2026-09-02", "milestone": "M", "markdown": "B",
    }).state
    validated = tracker.validate_tracker_state(state)
    check("the journal validates", validated["version"] == 3)
    check("tags are normalised on the way through", validated["projects"][0]["tags"] == ["one"],
          validated["projects"][0]["tags"])


def test_every_operation_is_reachable() -> None:
    check(
        "the operation set is closed and complete",
        set(journal.OPERATION_NAMES) == {
            "create_project", "update_project", "delete_project",
            "record_entry", "update_entry", "delete_entry", "move_entry",
        },
        repr(journal.OPERATION_NAMES),
    )


def main() -> int:
    print("journal.py tests\n")
    for test in (
        test_unknown_operations,
        test_create_project,
        test_update_project,
        test_delete_project_cascades,
        test_record_entry,
        test_update_entry,
        test_delete_entry,
        test_move_entry_stays_within_its_project,
        test_move_entry_at_the_ends,
        test_results_are_valid_journals,
        test_every_operation_is_reachable,
    ):
        print(f"{test.__name__}")
        test()
    print(f"\n{PASS} passed, {FAIL} failed")
    return 1 if FAIL else 0


if __name__ == "__main__":
    raise SystemExit(main())
