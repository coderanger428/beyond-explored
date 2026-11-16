"""One page of GitHub's public account list. No profile, email, or social lookup."""

from __future__ import annotations

GITHUB_USERS_URL = "https://api.github.com/users"
PAGE_SIZE = 100
POOL_CAP = 100


def account_rows(payload: object) -> list[dict[str, str | int]]:
    """Keep id, login, type, and profile URL from a GET /users page."""
    if not isinstance(payload, list):
        return []
    rows: list[dict[str, str | int]] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        try:
            github_id = int(item.get("id"))
        except (TypeError, ValueError):
            continue
        if github_id <= 0:
            continue
        login = str(item.get("login") or "").strip()
        if not login or any(ch.isspace() or ch in "/\\" for ch in login):
            continue
        account_type = str(item.get("type") or "User").strip() or "User"
        html_url = str(item.get("html_url") or "").strip()
        if not html_url.startswith("https://github.com/"):
            html_url = f"https://github.com/{login}"
        rows.append(
            {
                "github_id": github_id,
                "login": login,
                "account_type": account_type,
                "html_url": html_url,
            }
        )
    return rows


def queue_for_pool(rows: list[dict], *, room: int) -> tuple[list[dict], int | None]:
    """Usernames that still fit under the pool cap.

    The second value is the id to resume from when the page was cut short.
    None means the whole page was accepted and the caller should move past
    its highest id, including organizations that were not queued.
    """
    space = max(0, int(room))
    people = [row for row in rows if str(row.get("account_type", "")).lower() == "user"]
    if space <= 0 or not people:
        return [], None
    if len(people) <= space:
        return people, None
    kept = people[:space]
    return kept, int(kept[-1]["github_id"])


def page_since(rows: list[dict], previous: int) -> int:
    """Next `since` is the highest id on the page. An empty page stays put."""
    ids = [int(row["github_id"]) for row in rows]
    if not ids:
        return max(0, int(previous))
    return max(int(previous), max(ids))


def _header(headers: object, name: str) -> str:
    if headers is None:
        return ""
    getter = getattr(headers, "get", None)
    if getter is None:
        return ""
    value = getter(name)
    if value is None:
        value = getter(name.lower())
    return "" if value is None else str(value).strip()


def _int(value: str) -> int | None:
    if not value:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def rate_limit_wait_seconds(
    status_code: int, headers: object, *, now: float
) -> float:
    """Seconds to wait before another list call. Zero means the page can be saved.

    A 200 with remaining quota waits 0. A used-up quota, 403, or 429 waits
    until GitHub's reset time. 401 is an authentication problem, not a wait.
    """
    if status_code == 401:
        return 0.0
    remaining = _int(_header(headers, "X-RateLimit-Remaining"))
    limited = status_code in (403, 429) or remaining == 0
    if status_code == 200 and not limited:
        return 0.0
    if status_code not in (200, 403, 429):
        return 0.0
    retry_after = _header(headers, "Retry-After")
    if retry_after:
        try:
            return max(1.0, float(retry_after))
        except ValueError:
            pass
    reset = _int(_header(headers, "X-RateLimit-Reset"))
    if reset is not None:
        return max(1.0, float(reset) - float(now))
    if limited:
        return 60.0
    return 0.0
