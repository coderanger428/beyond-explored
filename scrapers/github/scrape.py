"""
Walk GitHub user ids into a temporary pool of at most 100 usernames.

Each pooled username is then looked up with this scraper's token, the same
way a dev.to profile looks up its GitHub account. A person who publishes an
email is merged into the main users table with source github, and the username
leaves the pool. The next page is fetched only after the pool is empty.
"""

from __future__ import annotations

import time

import requests

import core.db as app_db
from core.github_enrich import github_scrape_token
from core.github_lookup import investigate_github_user, save_github_contact
from scrapers.github.walk import (
    GITHUB_USERS_URL,
    PAGE_SIZE,
    POOL_CAP,
    account_rows,
    page_since,
    queue_for_pool,
    rate_limit_wait_seconds,
)

SOURCE = "github"
IDLE_POLL_SEC = 5.0
END_OF_LIST_SEC = 60.0
REQUEST_TIMEOUT_SEC = 20


def _heartbeat(conn, *, loop: str) -> None:
    app_db.touch_scrape_heartbeat(conn, loop=loop, platform_id=SOURCE)
    conn.commit()


def _sleep_while(conn, seconds: float, *, loop: str) -> None:
    """Sleep in short slices so the dashboard heartbeat stays fresh."""
    deadline = time.monotonic() + max(0.0, seconds)
    while True:
        if app_db.is_scrape_paused(conn, SOURCE):
            return
        _heartbeat(conn, loop=loop)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return
        time.sleep(min(IDLE_POLL_SEC, remaining))


def _remember_rate(conn, headers: object) -> None:
    raw = ""
    getter = getattr(headers, "get", None)
    if getter is not None:
        value = getter("X-RateLimit-Remaining")
        raw = "" if value is None else str(value).strip()
    if raw:
        app_db.set_meta(conn, "github_scrape_rate_remaining", raw)


def _pause_for_lookup(conn):
    def pause(_seconds: float, _note: str) -> None:
        _heartbeat(conn, loop=app_db.SCRAPE_LOOP_IDLING)

    return pause


def investigate_pool(conn, session: requests.Session, token: str) -> str:
    """Look up every pooled login. Returns ok, unauthorized, or paused.

    A rate limit waits and retries the same login. A finished lookup leaves
    the pool whether or not the person was saved.
    """
    while True:
        if app_db.is_scrape_paused(conn, SOURCE):
            return "paused"
        pool = app_db.list_github_pool(conn)
        if not pool:
            return "ok"
        row = pool[0]
        person = investigate_github_user(
            session,
            row["login"],
            token,
            pause=_pause_for_lookup(conn),
        )
        if person.status == "unauthorized":
            return "unauthorized"
        if person.status == "rate_limited":
            print(f"[github] rate limit, waiting {int(person.wait_seconds)}s")
            _sleep_while(conn, person.wait_seconds, loop=app_db.SCRAPE_LOOP_IDLING)
            continue
        if person.status == "failed":
            print(f"[github] lookup failed for {row['login']}, keeping it in the pool")
            _sleep_while(conn, END_OF_LIST_SEC, loop=app_db.SCRAPE_LOOP_IDLING)
            continue
        if person.status == "ok" and person.email:
            existing = app_db.find_user_by_github(conn, person.login)
            outcome = save_github_contact(
                conn,
                person,
                source=SOURCE,
                link=f"https://github.com/{person.login}",
                platform_user_id=row["github_id"],
                prior_country=existing["country"] if existing is not None else "noloc",
                prior_location=existing["location"] if existing is not None else "",
            )
            if outcome == "skipped":
                print(f"[github] skip blocked country ({row['login']})")
            elif outcome == "noloc":
                print(f"[github] skip no location ({row['login']})")
            elif outcome == "saved":
                print(f"[github] saved {person.login}")
            elif outcome == "duplicate":
                print(f"[github] duplicate github username {person.login}")
        app_db.delete_github_account(conn, row["github_id"])
        _heartbeat(conn, loop=app_db.SCRAPE_LOOP_RUNNING)
        conn.commit()


def main() -> None:
    app_db.init_db()
    warned_missing = False
    warned_rejected = False
    with app_db.get_conn() as conn:
        removed = app_db.trim_github_pool(conn, POOL_CAP)
        if removed:
            top = conn.execute("SELECT MAX(github_id) AS n FROM github_accounts").fetchone()
            if top is not None and top["n"] is not None:
                app_db.set_scrape_state(conn, last_id=int(top["n"]), platform_id=SOURCE)
            print(f"[github] pool capped at {POOL_CAP}, set aside {removed} extra usernames")
        state = app_db.get_scrape_state(conn, SOURCE)
        conn.commit()
    since = int(state["last_id"])
    print(f"[github] account list from id {since}")

    session = requests.Session()
    while True:
        with app_db.get_conn() as conn:
            if app_db.is_scrape_paused(conn, SOURCE):
                _heartbeat(conn, loop=app_db.SCRAPE_LOOP_IDLING)
                time.sleep(IDLE_POLL_SEC)
                continue
            token = github_scrape_token()
            if not token:
                if not warned_missing:
                    print(
                        "[github] waiting for a scraper token. "
                        "Add it on the github.com scraper page."
                    )
                    warned_missing = True
                _heartbeat(conn, loop=app_db.SCRAPE_LOOP_IDLING)
                time.sleep(IDLE_POLL_SEC)
                continue
            warned_missing = False
            outcome = investigate_pool(conn, session, token)
            if outcome == "paused":
                continue
            if outcome == "unauthorized":
                if not warned_rejected:
                    print("[github] GitHub rejected the scraper token.")
                    warned_rejected = True
                _sleep_while(conn, END_OF_LIST_SEC, loop=app_db.SCRAPE_LOOP_IDLING)
                continue
            warned_rejected = False
            if app_db.list_github_pool(conn):
                continue
            _heartbeat(conn, loop=app_db.SCRAPE_LOOP_RUNNING)

        try:
            response = session.get(
                GITHUB_USERS_URL,
                params={"since": since, "per_page": PAGE_SIZE},
                headers={
                    "Accept": "application/vnd.github+json",
                    "Authorization": f"Bearer {token}",
                    "User-Agent": "scraping_dev_bot/1.0",
                },
                timeout=REQUEST_TIMEOUT_SEC,
            )
        except requests.RequestException as exc:
            print(f"[github] list request failed: {exc}")
            with app_db.get_conn() as conn:
                _sleep_while(conn, END_OF_LIST_SEC, loop=app_db.SCRAPE_LOOP_IDLING)
            continue

        wait = rate_limit_wait_seconds(
            response.status_code, response.headers, now=time.time()
        )
        with app_db.get_conn() as conn:
            _remember_rate(conn, response.headers)
            conn.commit()
        if response.status_code == 401:
            if not warned_rejected:
                print("[github] GitHub rejected the scraper token.")
                warned_rejected = True
            with app_db.get_conn() as conn:
                _sleep_while(conn, END_OF_LIST_SEC, loop=app_db.SCRAPE_LOOP_IDLING)
            continue
        warned_rejected = False
        if wait > 0:
            print(f"[github] rate limit, waiting {int(wait)}s")
            with app_db.get_conn() as conn:
                _sleep_while(conn, wait, loop=app_db.SCRAPE_LOOP_IDLING)
            continue
        if response.status_code != 200:
            print(f"[github] list HTTP {response.status_code}")
            with app_db.get_conn() as conn:
                _sleep_while(conn, END_OF_LIST_SEC, loop=app_db.SCRAPE_LOOP_IDLING)
            continue

        try:
            payload = response.json()
        except ValueError:
            print("[github] list response was not JSON")
            with app_db.get_conn() as conn:
                _sleep_while(conn, END_OF_LIST_SEC, loop=app_db.SCRAPE_LOOP_IDLING)
            continue

        rows = account_rows(payload)
        if not rows:
            with app_db.get_conn() as conn:
                _sleep_while(conn, END_OF_LIST_SEC, loop=app_db.SCRAPE_LOOP_IDLING)
            continue

        with app_db.get_conn() as conn:
            room = POOL_CAP - len(app_db.list_github_pool(conn))
            people, cut_at = queue_for_pool(rows, room=room)
            pooled = app_db.insert_github_accounts(conn, people)
            since = cut_at if cut_at is not None else page_since(rows, since)
            app_db.set_scrape_state(conn, last_id=since, platform_id=SOURCE)
            _heartbeat(conn, loop=app_db.SCRAPE_LOOP_RUNNING)
            conn.commit()
        print(f"[github] pooled {pooled} usernames through id {since}")
