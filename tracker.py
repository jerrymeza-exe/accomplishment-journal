"""Data rules for the Accomplishment Journal.

This is a faithful port of the original app's ``lib/tracker.ts``. It owns the
rules for what counts as valid journal state, how older backups are migrated
into the current Markdown-entry format, and how a project is serialized to
CSV. The HTTP server in :mod:`app` treats this module as the
single source of truth for data integrity.

Everything here is pure and side-effect free so it is easy to test.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import Any

# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

STORAGE_VERSION = 3

_CSV_HEADERS: tuple[str, ...] = ("project", "date", "milestone", "title", "markdown")

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class BackupError(ValueError):
    """Raised when a state/backup payload fails validation.

    Mirrors the ``throw new Error(...)`` calls in the TypeScript original; the
    message is surfaced verbatim to the user in the app's notice area.
    """


# ---------------------------------------------------------------------------
# Small pure helpers
# ---------------------------------------------------------------------------

def empty_tracker_state() -> dict[str, Any]:
    return {"version": STORAGE_VERSION, "projects": [], "achievements": []}


def create_id(prefix: str) -> str:
    """Stable, sortable-enough identifier, e.g. ``project-3f2a...``."""
    return f"{prefix}-{uuid.uuid4()}"


def to_local_date_input(date: datetime | None = None) -> str:
    """Local calendar date as ``YYYY-MM-DD`` (what ``<input type=date>`` uses)."""
    date = date or datetime.now()
    return date.strftime("%Y-%m-%d")


def is_calendar_date(value: str) -> bool:
    """True when ``value`` is a real ``YYYY-MM-DD`` day.

    The shape check alone accepted ``2026-13-45``, which then reached the
    interface and was rendered as a rolled-over ``14 FEB 2027``. Rejecting
    impossible days here means no reader ever has to decide what one means.
    """
    if not _DATE_RE.match(value):
        return False
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        return False
    return True


# ---------------------------------------------------------------------------
# Validation primitives
# ---------------------------------------------------------------------------

def _is_record(value: Any) -> bool:
    return isinstance(value, dict)


def _required_string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise BackupError(f"Backup has an invalid {label}.")
    return value.strip()


def _optional_string(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _valid_date(value: Any, label: str) -> str:
    date = _required_string(value, label)
    if not is_calendar_date(date):
        raise BackupError(f"Backup has an invalid {label}.")
    return date


def _valid_tags(value: Any) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list) or any(not isinstance(tag, str) for tag in value):
        raise BackupError("Backup has invalid project tags.")
    seen: set[str] = set()
    result: list[str] = []
    for tag in value:
        cleaned = tag.strip()
        if cleaned and cleaned not in seen:
            seen.add(cleaned)
            result.append(cleaned)
    return result


def _valid_projects(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise BackupError("This is not a compatible Accomplishment Journal backup.")
    projects: list[dict[str, Any]] = []
    for item in value:
        if not _is_record(item):
            raise BackupError("Backup has an invalid project.")
        projects.append(
            {
                "id": _required_string(item.get("id"), "project ID"),
                "name": _required_string(item.get("name"), "project name"),
                "description": _optional_string(item.get("description")),
                "startedOn": _valid_date(item.get("startedOn"), "project start date"),
                "tags": _valid_tags(item.get("tags")),
                "updatedAt": _required_string(item.get("updatedAt"), "project update date"),
            }
        )
    ids = [p["id"] for p in projects]
    if len(set(ids)) != len(ids):
        raise BackupError("Backup includes duplicate project IDs.")
    return projects


def _valid_achievements(value: Any, project_ids: set[str]) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise BackupError("This is not a compatible Accomplishment Journal backup.")
    achievements: list[dict[str, Any]] = []
    for item in value:
        if not _is_record(item):
            raise BackupError("Backup has an invalid accomplishment.")
        project_id = _required_string(item.get("projectId"), "accomplishment project")
        if project_id not in project_ids:
            raise BackupError("Backup includes an accomplishment with a missing project.")
        achievements.append(
            {
                "id": _required_string(item.get("id"), "accomplishment ID"),
                "projectId": project_id,
                "title": _required_string(item.get("title"), "accomplishment title"),
                "date": _valid_date(item.get("date"), "accomplishment date"),
                # Journals written before the rename still label this
                # ``category``. Reading both means an older file keeps its
                # milestones instead of importing them as blanks.
                "milestone": _optional_string(item.get("milestone")) or _optional_string(item.get("category")),
                "markdown": _optional_string(item.get("markdown")),
                "createdAt": _required_string(item.get("createdAt"), "accomplishment creation date"),
                "updatedAt": _required_string(item.get("updatedAt"), "accomplishment update date"),
            }
        )
    ids = [a["id"] for a in achievements]
    if len(set(ids)) != len(ids):
        raise BackupError("Backup includes duplicate accomplishment IDs.")
    return achievements


# ---------------------------------------------------------------------------
# Legacy (v1/v2) migration
# ---------------------------------------------------------------------------

def _legacy_markdown(item: dict[str, Any]) -> str:
    """Fold a structured v1 accomplishment into a Markdown body."""
    sections: list[str] = [str(item.get("description", "")).strip()]
    impact = str(item.get("impact", "")).strip()
    if impact:
        sections.append(f"**Impact**\n\n{impact}")
    skills_raw = item.get("skills")
    skills: list[str] = (
        [str(s) for s in skills_raw]
        if isinstance(skills_raw, list)
        else []
    )
    cleaned_skills = [s.strip() for s in skills if s.strip()]
    if cleaned_skills:
        sections.append("- Tools / skills: " + ", ".join(cleaned_skills))
    notes = str(item.get("notes", "")).strip()
    if notes:
        sections.append(f"> {notes}")
    return "\n\n".join(s for s in sections if s)


def migrate_legacy(value: dict[str, Any]) -> dict[str, Any]:
    """Convert a v1 structured-accomplishment journal into the current shape."""
    projects = _valid_projects(value.get("projects"))
    project_ids = {p["id"] for p in projects}
    if not isinstance(value.get("achievements"), list):
        raise BackupError("This is not a compatible Accomplishment Journal backup.")

    achievements: list[dict[str, Any]] = []
    for item in value["achievements"]:
        if not _is_record(item):
            raise BackupError("Backup has an invalid achievement.")
        skills_raw = item.get("skills")
        skills: list[str] = (
            [s for s in skills_raw if isinstance(s, str)]
            if isinstance(skills_raw, list) and all(isinstance(s, str) for s in skills_raw)
            else []
        )
        legacy: dict[str, Any] = {
            "id": _required_string(item.get("id"), "achievement ID"),
            "projectId": _required_string(item.get("projectId"), "accomplishment project"),
            "title": _required_string(item.get("title"), "achievement title"),
            "date": _valid_date(item.get("date"), "achievement date"),
            "category": _optional_string(item.get("category")) or "General",
            "description": _required_string(item.get("description"), "achievement description"),
            "impact": _optional_string(item.get("impact")),
            "skills": skills,
            "notes": _optional_string(item.get("notes")),
            "createdAt": _required_string(item.get("createdAt"), "achievement creation date"),
            "updatedAt": _required_string(item.get("updatedAt"), "achievement update date"),
        }
        if legacy["projectId"] not in project_ids:
            raise BackupError("Backup includes an achievement with a missing project.")
        achievements.append(
            {
                "id": legacy["id"],
                "projectId": legacy["projectId"],
                "title": legacy["title"],
                "date": legacy["date"],
                "milestone": legacy["category"],
                "markdown": _legacy_markdown(legacy),
                "createdAt": legacy["createdAt"],
                "updatedAt": legacy["updatedAt"],
            }
        )
    return {"version": STORAGE_VERSION, "projects": projects, "achievements": achievements}


def validate_tracker_state(value: Any) -> dict[str, Any]:
    """Validate (and, if needed, migrate) an arbitrary payload into v3 state.

    Raises :class:`BackupError` with a user-facing message on any problem.
    """
    if not _is_record(value):
        raise BackupError("This is not a compatible Accomplishment Journal backup.")
    version = value.get("version")
    if version not in (1, 2, STORAGE_VERSION):
        raise BackupError("This backup was made by an incompatible journal version.")
    if version == 1:
        return migrate_legacy(value)
    projects = _valid_projects(value.get("projects"))
    project_ids = {p["id"] for p in projects}
    return {
        "version": STORAGE_VERSION,
        "projects": projects,
        "achievements": _valid_achievements(value.get("achievements"), project_ids),
    }


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

class UnknownProject(LookupError):
    """Raised when an export names a project this journal does not hold."""


def _escape_cell(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def _project_slug(name: str) -> str:
    """Filename-friendly slug for a project name."""
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "project"


def export_project_log(state: dict[str, Any], project_id: str) -> tuple[str, bytes]:
    """One project's log as a downloadable CSV: ``(filename, bytes)``.

    Everything an export *is* lives here — which entries are included, the
    column set and its order, the quoting, the CRLF line endings, and the
    name the file arrives under. Callers pass what they already have (the
    journal and a project id) and get something they can send; nothing
    outside this module needs to know the row shape.

    The bytes are the same ones the original TypeScript app produced: a bare
    header row, every data cell double-quoted with ``""`` escapes, CRLF
    between rows and none at the end.

    Raises :class:`UnknownProject` when the journal holds no such project.
    """
    project = next((p for p in state["projects"] if p["id"] == project_id), None)
    if project is None:
        raise UnknownProject(project_id)

    lines = [",".join(_CSV_HEADERS)]
    for entry in state["achievements"]:
        if entry["projectId"] != project_id:
            continue
        row = {
            "project": project["name"],
            "date": entry["date"],
            "milestone": entry["milestone"],
            "title": entry["title"],
            "markdown": entry["markdown"],
        }
        lines.append(",".join(_escape_cell(str(row[header])) for header in _CSV_HEADERS))

    filename = f"{_project_slug(project['name'])}-log.csv"
    return filename, "\r\n".join(lines).encode("utf-8")
