"""Public Telegram username check for social handles already stored on a user.

t.me/{username} shows a public account, bot, channel, or group when one exists.
A missing name is the generic contact page. This is an exact username lookup.
"""

from __future__ import annotations

import re
import time
from collections.abc import Callable
from typing import Any
from urllib.parse import urlparse

import requests

import core.db as app_db

# Same username-shaped sites as socialCopyValue in frontend/src/lib/social.js.
USERNAME_PROVIDERS = frozenset({
    "x",
    "instagram",
    "tiktok",
    "threads",
    "bluesky",
    "mastodon",
    "reddit",
    "npm",
})

_OFFERED_HANDLE = re.compile(r"^[A-Za-z0-9_]{1,32}$")
# Telegram usernames are 5–32 characters and start with a letter.
_TELEGRAM_HANDLE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{4,31}$")
_TITLE = re.compile(r"<title>(.*?)</title>", re.IGNORECASE | re.DOTALL)
_PAGE_SIZE = 50

Lookup = Callable[[str], str]


def social_handle(provider: str | None, url: str | None) -> str:
    """Last path segment for a username-shaped social link. Empty when it is not one."""
    name = (provider or "").strip().lower()
    if name == "twitter":
        name = "x"
    if name not in USERNAME_PROVIDERS:
        return ""
    try:
        path = urlparse(url or "").path.strip("/")
    except ValueError:
        return ""
    segment = path.split("/")[-1] if path else ""
    handle = segment[1:] if segment[:1] in "@~" else segment
    if not _OFFERED_HANDLE.fullmatch(handle):
        return ""
    return handle


def telegram_page_state(html: str | None) -> str:
    """exists when t.me rendered a public account. missing for the contact shell."""
    text = html or ""
    if "tgme_page_extra" in text:
        return "exists"
    match = _TITLE.search(text)
    title = match.group(1).strip() if match else ""
    if title.startswith("Telegram: Contact @"):
        return "missing"
    return "unknown"


def fetch_telegram_state(session: requests.Session, username: str) -> str:
    """exists, missing, or unknown. A network failure stays unknown so nothing is failed."""
    try:
        response = session.get(
            f"https://t.me/{username}",
            headers={"User-Agent": "devto-scraper telegram check"},
            timeout=15,
        )
    except requests.RequestException:
        return "unknown"
    if response.status_code != 200:
        return "unknown"
    return telegram_page_state(response.text)


def live_lookup(pause_sec: float = 0.25) -> Lookup:
    session = requests.Session()

    def lookup(username: str) -> str:
        state = fetch_telegram_state(session, username)
        if pause_sec > 0:
            time.sleep(pause_sec)
        return state

    return lookup


def _has_telegram(links: list[dict[str, str]]) -> bool:
    for item in links:
        if item.get("provider") == "telegram":
            return True
        url = str(item.get("url") or "").lower()
        if "://t.me/" in url or "://telegram.me/" in url:
            return True
    return False


def _ordered_ids(user_ids: list[int], limit: int | None = _PAGE_SIZE) -> list[int]:
    seen: set[int] = set()
    ordered: list[int] = []
    source = user_ids if limit is None else user_ids[:limit]
    for raw in source:
        user_id = int(raw)
        if user_id <= 0 or user_id in seen:
            continue
        seen.add(user_id)
        ordered.append(user_id)
    return ordered


def _candidates_for_links(user_id: int, links: list[dict[str, str]]) -> list[dict[str, Any]]:
    if _has_telegram(links):
        return []
    found: list[dict[str, Any]] = []
    for link in links:
        status = link["status"] or "not_sent"
        if status != "not_sent":
            continue
        handle = social_handle(link["provider"], link["url"])
        if not handle:
            continue
        found.append({
            "user_id": user_id,
            "url": link["url"],
            "handle": handle,
            "lookup": bool(_TELEGRAM_HANDLE.fullmatch(handle)),
        })
    return found


def telegram_candidates(
    conn,
    user_ids: list[int],
    limit: int | None = _PAGE_SIZE,
) -> list[dict[str, Any]]:
    """Username links still worth a Telegram check. Reads only."""
    candidates: list[dict[str, Any]] = []
    for user_id in _ordered_ids(user_ids, limit):
        row = conn.execute(
            "SELECT socials FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        if row is None:
            continue
        links = app_db.load_social_links(row["socials"])
        candidates.extend(_candidates_for_links(user_id, links))
    return candidates


def resolve_telegram_candidates(
    candidates: list[dict[str, Any]],
    lookup: Lookup,
    cache: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Ask t.me once per username. An impossible handle is missing without a request."""
    checked = 0
    failed = 0
    found = 0
    unknown = 0
    if cache is None:
        cache = {}
    decisions: list[dict[str, Any]] = []
    for item in candidates:
        checked += 1
        if not item["lookup"]:
            failed += 1
            decisions.append({**item, "state": "missing"})
            continue
        key = item["handle"].lower()
        state = cache.get(key)
        if state is None:
            state = lookup(item["handle"])
            if state not in {"exists", "missing", "unknown"}:
                state = "unknown"
            cache[key] = state
        if state == "exists":
            found += 1
        elif state == "missing":
            failed += 1
        else:
            unknown += 1
        decisions.append({**item, "state": state})
    return {
        "checked": checked,
        "failed": failed,
        "found": found,
        "unknown": unknown,
        "decisions": decisions,
    }


def apply_telegram_failures(conn, decisions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Write failed onto links whose Telegram name is missing."""
    by_user: dict[int, list[str]] = {}
    for item in decisions:
        if item.get("state") != "missing":
            continue
        by_user.setdefault(int(item["user_id"]), []).append(str(item["url"]))
    users: list[dict[str, Any]] = []
    for user_id, urls in by_user.items():
        saved = None
        for url in urls:
            saved = app_db.set_user_contact(
                conn,
                user_id,
                channel="social",
                status="failed",
                social_url=url,
            )
        if saved is not None:
            users.append(saved)
    return users


def check_telegram_handles(
    conn,
    user_ids: list[int],
    lookup: Lookup,
) -> dict[str, Any]:
    """Mark not-sent username links failed when that exact Telegram name is missing.

    A user who already has a Telegram link is left alone. Sent links stay sent.
    Unknown answers are not marked failed.
    """
    resolved = resolve_telegram_candidates(telegram_candidates(conn, user_ids), lookup)
    users = apply_telegram_failures(conn, resolved["decisions"])
    return {
        "checked": resolved["checked"],
        "failed": resolved["failed"],
        "found": resolved["found"],
        "unknown": resolved["unknown"],
        "users": users,
    }
