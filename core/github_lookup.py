"""Look up one public GitHub profile and merge a contact into the main user table.

Every scraper calls this with its own token. The caller decides where the
username came from. A public email is required, matching the dev.to save rule.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import requests

import core.db as app_db
from core.telegram_lookup import check_telegram_handles, live_lookup
from core.github_enrich import (
    build_social_links,
    combine_social_links,
    fetch_json,
    fetch_profile_readme,
    place_from_text,
    profile_bio,
    profile_location,
    profile_name,
    social_accounts_path,
    user_path,
    REQUEST_DELAY_SEC,
)


@dataclass
class GithubPerson:
    status: str
    login: str = ""
    email: str = ""
    name: str = ""
    bio: str = ""
    location: str = ""
    socials: list[dict[str, str]] | None = None
    wait_seconds: float = 0.0
    profile: dict = field(default_factory=dict)


def investigate_github_user(
    session: requests.Session,
    username: str,
    token: str,
    *,
    pause=None,
) -> GithubPerson:
    """Read one GitHub profile with this scraper's token.

    Social links are requested only when the profile publishes an email,
    because a profile without an email is not stored.
    status is ok, missing, unauthorized, rate_limited, or failed.
    """
    login = (username or "").strip()
    status, payload = fetch_json(session, user_path(login), token=token, pause=pause)
    if status == "rate_limited":
        wait = payload if isinstance(payload, (int, float)) else 60.0
        return GithubPerson(status="rate_limited", login=login, wait_seconds=float(wait))
    if status != "ok" or not isinstance(payload, dict):
        return GithubPerson(status=status if status != "ok" else "failed", login=login)
    email = str(payload.get("email") or "").strip()
    socials = None
    if email:
        time.sleep(REQUEST_DELAY_SEC)
        social_status, social_payload = fetch_json(
            session,
            social_accounts_path(login),
            token=token,
            pause=pause,
        )
        if social_status == "rate_limited":
            wait = social_payload if isinstance(social_payload, (int, float)) else 60.0
            return GithubPerson(
                status="rate_limited",
                login=login,
                email=email,
                wait_seconds=float(wait),
                profile=payload,
            )
        if social_status == "unauthorized":
            return GithubPerson(status="unauthorized", login=login, email=email, profile=payload)
        if social_status == "failed":
            socials = None
        elif social_status == "missing" or not isinstance(social_payload, list):
            socials = []
        else:
            socials = build_social_links(payload, social_payload)
        if socials is not None:
            time.sleep(REQUEST_DELAY_SEC)
            readme_status, readme_text, readme_wait = fetch_profile_readme(
                session,
                login,
                token=token,
                pause=pause,
            )
            if readme_status == "rate_limited":
                return GithubPerson(
                    status="rate_limited",
                    login=login,
                    email=email,
                    wait_seconds=readme_wait,
                    profile=payload,
                )
            if readme_status == "unauthorized":
                return GithubPerson(status="unauthorized", login=login, email=email, profile=payload)
            if readme_status == "failed":
                return GithubPerson(status="failed", login=login, email=email, profile=payload)
            if readme_status == "ok":
                socials = combine_social_links(socials, readme_text)
    return GithubPerson(
        status="ok",
        login=str(payload.get("login") or login),
        email=email,
        name=profile_name(payload),
        bio=profile_bio(payload),
        location=profile_location(payload),
        socials=socials,
        profile=payload,
    )


def apply_github_place(
    country: str, location: str, github_location: str
) -> tuple[str, str, bool]:
    """Keep a known place. Fill noloc from GitHub text. A blocked GitHub country is skipped."""
    current = (country or "").strip().lower() or "noloc"
    if current != "noloc":
        return current, location or "", False
    placed = place_from_text(github_location)
    if placed.skipped:
        return placed.country, "", True
    if placed.country != "noloc":
        return placed.country, placed.location, False
    return "noloc", "", False


def _remember_profile(conn, user_id: int, person: GithubPerson) -> None:
    app_db.update_github_profile(
        conn,
        user_id,
        bio=person.bio,
        github_name=person.name,
        socials=person.socials,
        github_location=person.location,
    )


def store_github_contact(
    conn,
    person: GithubPerson,
    *,
    source: str,
    link: str,
    platform_user_id: int | str | None,
    country: str,
    location: str,
    name: str = "",
) -> str:
    """Write one investigated person into users. Returns saved, duplicate, or skipped.

    The same GitHub username is one person. A row the GitHub scraper already
    owns is left unchanged when dev.to sees that username. When the GitHub
    scraper sees a dev.to row, it takes over the row.
    """
    if person.status != "ok" or not person.email:
        return "skipped"
    login = (person.login or "").strip()
    priority = app_db.source_origin(source) == "github"
    match = app_db.find_user_by_github(conn, login)
    if match is not None:
        if priority:
            app_db.claim_github_scraper(
                conn,
                int(match["id"]),
                email=person.email,
                link=link,
                location=location,
                country=country,
                platform_user_id=platform_user_id,
                github=login,
            )
            _remember_profile(conn, int(match["id"]), person)
        elif app_db.source_origin(match["source"]) != "github":
            _remember_profile(conn, int(match["id"]), person)
        return "duplicate"

    email_row = conn.execute(
        "SELECT id, github, source FROM users WHERE email = ? COLLATE NOCASE",
        (person.email.strip(),),
    ).fetchone()
    if email_row is not None:
        other_login = str(email_row["github"] or "").strip()
        same_login = other_login.lower() == login.lower()
        if priority and (not other_login or same_login):
            app_db.claim_github_scraper(
                conn,
                int(email_row["id"]),
                email=person.email,
                link=link,
                location=location,
                country=country,
                platform_user_id=platform_user_id,
                github=login,
            )
            _remember_profile(conn, int(email_row["id"]), person)
        elif app_db.source_origin(email_row["source"]) != "github" and (
            not other_login or same_login
        ):
            _remember_profile(conn, int(email_row["id"]), person)
        return "duplicate"

    stored_name = (name or person.name or person.login).strip()
    inserted, user_id = app_db.insert_user(
        conn,
        email=person.email,
        name=stored_name,
        link=link,
        github=login,
        location=location,
        country=country,
        source=source,
        platform_user_id=platform_user_id,
    )
    if user_id is None:
        return "skipped"
    _remember_profile(conn, user_id, person)
    if inserted:
        check_telegram_handles(conn, [user_id], live_lookup(pause_sec=0))
    return "saved" if inserted else "duplicate"


def save_github_contact(
    conn,
    person: GithubPerson,
    *,
    source: str,
    link: str,
    platform_user_id: int | str | None,
    prior_country: str,
    prior_location: str,
    name: str = "",
) -> str:
    """Apply the usual place rules, then store. Returns saved, duplicate, or skipped.

    A blocked country is not stored. The GitHub scraper also removes a row it
    already has for that username, including one first saved from dev.to.
    Dev.to does not remove a row the GitHub scraper owns.
    """
    if person.status != "ok" or not person.email:
        return "skipped"
    login = (person.login or "").strip()
    priority = app_db.source_origin(source) == "github"
    if not priority:
        owned = app_db.find_user_by_github(conn, login)
        if owned is not None and app_db.source_origin(owned["source"]) == "github":
            return "duplicate"
    country, location, blocked = apply_github_place(
        prior_country, prior_location, person.location
    )
    from core.locations import is_skipped_country

    if blocked or is_skipped_country(country):
        if priority:
            app_db.delete_users_by_github(conn, login)
        return "skipped"
    if country == "noloc" and not app_db.has_other_social(person.socials):
        return "noloc"
    return store_github_contact(
        conn,
        person,
        source=source,
        link=link,
        platform_user_id=platform_user_id,
        country=country,
        location=location,
        name=name,
    )
