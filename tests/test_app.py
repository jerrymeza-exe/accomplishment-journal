"""Tests for the local server's own decisions (``app.py``).

Run from the project root:

    python -m tests.test_app
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

# Make the project root importable no matter where this is run from.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app  # noqa: E402

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


def with_remote(url: str | None):
    """A throwaway directory holding a .git/config with the given origin."""
    root = Path(tempfile.mkdtemp())
    config = root / ".git"
    config.mkdir()
    body = '[core]\n\trepositoryformatversion = 0\n'
    if url is not None:
        body += f'[remote "origin"]\n\turl = {url}\n'
    (config / "config").write_text(body, encoding="utf-8")
    return root


def test_derives_the_pages_url() -> None:
    cases = [
        ("https://github.com/jerrymeza-exe/accomplishment-journal.git",
         "https://jerrymeza-exe.github.io/accomplishment-journal/share.html"),
        ("https://github.com/jerrymeza-exe/accomplishment-journal",
         "https://jerrymeza-exe.github.io/accomplishment-journal/share.html"),
        ("git@github.com:jerrymeza-exe/accomplishment-journal.git",
         "https://jerrymeza-exe.github.io/accomplishment-journal/share.html"),
    ]
    for url, expected in cases:
        got = app.pages_url_from_git_config(with_remote(url))
        check(f"derives from {url}", got == expected, f"got {got!r}")


def test_declines_to_guess() -> None:
    """A wrong-looking link 404s for the recipient and nobody reports it back,
    so anything unfamiliar answers None and lets --share-base decide."""
    for url in (None, "https://gitlab.com/someone/thing.git", "https://example.com/x"):
        got = app.pages_url_from_git_config(with_remote(url))
        check(f"declines {url}", got is None, f"got {got!r}")
    check("declines a directory with no .git", app.pages_url_from_git_config(Path(tempfile.mkdtemp())) is None)


def main() -> int:
    for test in (test_derives_the_pages_url, test_declines_to_guess):
        print(f"{test.__name__}")
        test()
    print(f"\n{PASS} passed, {FAIL} failed")
    return 1 if FAIL else 0


if __name__ == "__main__":
    raise SystemExit(main())
