"""The rules for how a journal changes.

Every way a journal can change is an **operation**: a small named intent like
``record_entry`` or ``delete_project``. :func:`apply` is the one way to run one,
and the set below is closed — if it is not here, it cannot happen.

The rules that used to live in the browser's event handlers live here instead:

* deleting a project takes its entries with it,
* writing or editing an entry marks its project as updated,
* a new entry goes to the head of the log,
* moving an entry reorders it within its own project and leaves every other
  project's entries exactly where they were.

Everything here is pure: an operation is applied to a state and a new state
comes back. The clock and the id factory are arguments, so the same operation
applied to the same state always produces the same journal — which is what
makes these rules testable without a browser, a server, or a disk.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable

import tracker


class OperationError(ValueError):
    """An operation that cannot be carried out. The message is user-facing."""


@dataclass(frozen=True)
class Applied:
    """A new journal, and the id of whatever the operation brought into being.

    ``created_id`` is the one thing a caller cannot work out from the state
    itself — everything else it needs, it can read off the journal.
    """

    state: dict[str, Any]
    created_id: str | None = None


# ---------------------------------------------------------------------------
# Reading fields off an operation
# ---------------------------------------------------------------------------

def _text(operation: dict[str, Any], field: str) -> str:
    value = operation.get(field)
    return value.strip() if isinstance(value, str) else ""


def _required_text(operation: dict[str, Any], field: str, message: str) -> str:
    value = _text(operation, field)
    if not value:
        raise OperationError(message)
    return value


def _date(operation: dict[str, Any], field: str) -> str:
    value = _text(operation, field)
    if not tracker.is_calendar_date(value):
        raise OperationError("That date could not be read.")
    return value


def _tags(operation: dict[str, Any]) -> list[str]:
    value = operation.get("tags")
    if value is None:
        return []
    if not isinstance(value, list) or any(not isinstance(tag, str) for tag in value):
        raise OperationError("Those tags could not be read.")
    # Trimming and de-duplication belong to validation, which runs on the way
    # to disk; passing them through keeps one rule in one place.
    return value


def _project(state: dict[str, Any], project_id: str) -> dict[str, Any]:
    for project in state["projects"]:
        if project["id"] == project_id:
            return project
    raise OperationError("That project is no longer in this journal.")


def _entry(state: dict[str, Any], entry_id: str) -> dict[str, Any]:
    for entry in state["achievements"]:
        if entry["id"] == entry_id:
            return entry
    raise OperationError("That entry is no longer in this journal.")


def _touch_project(state: dict[str, Any], project_id: str, stamp: str) -> list[dict[str, Any]]:
    """Mark a project as updated, because something in its log changed."""
    return [
        {**project, "updatedAt": stamp} if project["id"] == project_id else project
        for project in state["projects"]
    ]


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------

def _create_project(state, operation, stamp, new_id) -> Applied:
    project = {
        "id": new_id("project"),
        "name": _required_text(operation, "name", "Add a project name before saving."),
        "description": _text(operation, "description"),
        "startedOn": _date(operation, "startedOn"),
        "tags": _tags(operation),
        "updatedAt": stamp,
    }
    return Applied({**state, "projects": [*state["projects"], project]}, project["id"])


def _update_project(state, operation, stamp, new_id) -> Applied:
    target = _project(state, _text(operation, "id"))
    update = {
        "name": _required_text(operation, "name", "Add a project name before saving."),
        "description": _text(operation, "description"),
        "startedOn": _date(operation, "startedOn"),
        "tags": _tags(operation),
        "updatedAt": stamp,
    }
    projects = [
        {**project, **update} if project["id"] == target["id"] else project
        for project in state["projects"]
    ]
    return Applied({**state, "projects": projects})


def _delete_project(state, operation, stamp, new_id) -> Applied:
    """A project takes its log with it — the whole reason this rule needs a home."""
    target = _project(state, _text(operation, "id"))
    return Applied(
        {
            **state,
            "projects": [p for p in state["projects"] if p["id"] != target["id"]],
            "achievements": [e for e in state["achievements"] if e["projectId"] != target["id"]],
        }
    )


# ---------------------------------------------------------------------------
# Entries
# ---------------------------------------------------------------------------

_ENTRY_REQUIRED = "Add a title and a short log entry before saving."


def _entry_fields(state, operation, stamp) -> dict[str, Any]:
    project = _project(state, _text(operation, "projectId"))
    return {
        "projectId": project["id"],
        "title": _required_text(operation, "title", _ENTRY_REQUIRED),
        "date": _date(operation, "date"),
        "milestone": _text(operation, "milestone"),
        "markdown": _required_text(operation, "markdown", _ENTRY_REQUIRED),
        "updatedAt": stamp,
    }


def _record_entry(state, operation, stamp, new_id) -> Applied:
    fields = _entry_fields(state, operation, stamp)
    entry = {"id": new_id("entry"), "createdAt": stamp, **fields}
    return Applied(
        {
            **state,
            # Newest first: the head of the log is the most recent thing written.
            "achievements": [entry, *state["achievements"]],
            "projects": _touch_project(state, entry["projectId"], stamp),
        },
        entry["id"],
    )


def _update_entry(state, operation, stamp, new_id) -> Applied:
    target = _entry(state, _text(operation, "id"))
    fields = _entry_fields(state, operation, stamp)
    achievements = [
        {**entry, **fields} if entry["id"] == target["id"] else entry
        for entry in state["achievements"]
    ]
    return Applied(
        {
            **state,
            "achievements": achievements,
            # If the entry moved between projects, the project it landed in is
            # the one that just changed.
            "projects": _touch_project(state, fields["projectId"], stamp),
        }
    )


def _delete_entry(state, operation, stamp, new_id) -> Applied:
    target = _entry(state, _text(operation, "id"))
    achievements = [entry for entry in state["achievements"] if entry["id"] != target["id"]]
    return Applied({**state, "achievements": achievements})


def _move_entry(state, operation, stamp, new_id) -> Applied:
    """Swap an entry with its neighbour *within its own project's log*.

    Entries of every other project keep the slots they were in, so moving one
    project's entry never shuffles another project's log.
    """
    target = _entry(state, _text(operation, "id"))
    direction = operation.get("direction")
    if direction not in (-1, 1):
        raise OperationError("An entry can only move up or down.")

    scoped = [entry for entry in state["achievements"] if entry["projectId"] == target["projectId"]]
    position = next(i for i, entry in enumerate(scoped) if entry["id"] == target["id"])
    neighbour = position + direction
    if neighbour < 0 or neighbour >= len(scoped):
        return Applied(state)

    scoped[position], scoped[neighbour] = scoped[neighbour], scoped[position]
    moved = iter(scoped)
    achievements = [
        next(moved) if entry["projectId"] == target["projectId"] else entry
        for entry in state["achievements"]
    ]
    return Applied({**state, "achievements": achievements})


# ---------------------------------------------------------------------------
# The closed set
# ---------------------------------------------------------------------------

_OPERATIONS: dict[str, Callable[..., Applied]] = {
    "create_project": _create_project,
    "update_project": _update_project,
    "delete_project": _delete_project,
    "record_entry": _record_entry,
    "update_entry": _update_entry,
    "delete_entry": _delete_entry,
    "move_entry": _move_entry,
}

OPERATION_NAMES: tuple[str, ...] = tuple(_OPERATIONS)


def stamp_for(moment: datetime) -> str:
    """The timestamp format the journal has always used: UTC, milliseconds, ``Z``."""
    return (
        moment.astimezone(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def apply(
    state: dict[str, Any],
    operation: Any,
    *,
    now: datetime | None = None,
    new_id: Callable[[str], str] | None = None,
) -> Applied:
    """Run one operation against a journal and return the journal it produces.

    ``now`` and ``new_id`` default to the real clock and
    :func:`tracker.create_id`; pass them to make a change reproducible. Raises
    :class:`OperationError`, whose message is meant to be read by the person
    using the app, and never modifies the state it was given.
    """
    if not isinstance(operation, dict):
        raise OperationError("That is not an operation.")
    name = operation.get("op")
    handler = _OPERATIONS.get(name) if isinstance(name, str) else None
    if handler is None:
        raise OperationError(f"Unknown operation: {name!r}.")
    stamp = stamp_for(now or datetime.now(timezone.utc))
    return handler(state, operation, stamp, new_id or tracker.create_id)
