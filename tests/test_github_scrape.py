import sqlite3
import unittest
from unittest.mock import patch

import core.db as db
from core.github_enrich import github_headers, github_scrape_token, github_token
from core.github_lookup import (
    GithubPerson,
    apply_github_place,
    save_github_contact,
    store_github_contact,
)
from scrapers.github.walk import (
    POOL_CAP,
    account_rows,
    page_since,
    queue_for_pool,
    rate_limit_wait_seconds,
)


def _conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(db.SCHEMA_SQL)
    return conn


class GithubListTests(unittest.TestCase):
    def test_page_keeps_the_account_and_drops_profile_fields(self):
        rows = account_rows(
            [
                {
                    "id": 17,
                    "login": "octocat",
                    "type": "User",
                    "html_url": "https://github.com/octocat",
                    "email": "octocat@example.com",
                    "bio": "secret",
                    "location": "San Francisco",
                },
                {"id": 18, "login": "github", "type": "Organization", "html_url": ""},
                {"id": "nope", "login": "bad"},
            ]
        )
        self.assertEqual(
            rows,
            [
                {
                    "github_id": 17,
                    "login": "octocat",
                    "account_type": "User",
                    "html_url": "https://github.com/octocat",
                },
                {
                    "github_id": 18,
                    "login": "github",
                    "account_type": "Organization",
                    "html_url": "https://github.com/github",
                },
            ],
        )
        self.assertNotIn("email", rows[0])

    def test_pool_takes_at_most_one_hundred_users(self):
        rows = account_rows(
            [{"id": index, "login": f"user{index}", "type": "User"} for index in range(1, 130)]
            + [{"id": 200, "login": "acme", "type": "Organization"}]
        )
        queued, cut_at = queue_for_pool(rows, room=POOL_CAP)
        self.assertEqual(len(queued), 100)
        self.assertEqual(queued[0]["login"], "user1")
        self.assertEqual(queued[-1]["login"], "user100")
        self.assertEqual(cut_at, 100)
        self.assertTrue(all(row["account_type"] == "User" for row in queued))

    def test_pool_cap_drops_the_extra_names_and_rewinds_the_cursor(self):
        conn = _conn()
        try:
            db.insert_github_accounts(
                conn,
                [
                    {
                        "github_id": index,
                        "login": f"user{index}",
                        "account_type": "User",
                        "html_url": f"https://github.com/user{index}",
                    }
                    for index in range(1, 106)
                ],
            )
            db.set_scrape_state(conn, last_id=500, platform_id="github")
            removed = db.trim_github_pool(conn, POOL_CAP)
            self.assertEqual(removed, 5)
            self.assertEqual(len(db.list_github_pool(conn)), 100)
            top = conn.execute("SELECT MAX(github_id) AS n FROM github_accounts").fetchone()
            db.set_scrape_state(conn, last_id=int(top["n"]), platform_id="github")
            self.assertEqual(db.get_scrape_state(conn, "github")["last_id"], 100)
        finally:
            conn.close()

    def test_since_advances_to_the_highest_id(self):
        rows = account_rows(
            [
                {"id": 4, "login": "a", "type": "User"},
                {"id": 9, "login": "b", "type": "User"},
            ]
        )
        self.assertEqual(page_since(rows, 3), 9)
        self.assertEqual(page_since([], 9), 9)

    def test_rate_limit_waits_for_reset_and_a_normal_page_does_not(self):
        self.assertEqual(
            rate_limit_wait_seconds(200, {"X-RateLimit-Remaining": "40"}, now=100),
            0,
        )
        self.assertEqual(
            rate_limit_wait_seconds(
                403,
                {"X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "160"},
                now=100,
            ),
            60,
        )
        self.assertEqual(rate_limit_wait_seconds(401, {}, now=100), 0)

    def test_accounts_stay_out_of_the_mail_pool(self):
        conn = _conn()
        try:
            inserted = db.insert_github_accounts(
                conn,
                account_rows(
                    [
                        {"id": 5, "login": "ada", "type": "User"},
                        {"id": 5, "login": "ada", "type": "User"},
                        {"id": 6, "login": "grace", "type": "User"},
                    ]
                ),
            )
            self.assertEqual(inserted, 2)
            self.assertEqual(db.count_github_accounts(conn), 2)
            self.assertEqual(
                conn.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"], 0
            )
            db.set_scrape_state(conn, last_id=6, platform_id="github")
            snap = db.github_scrape_snapshot(conn)
            self.assertEqual(snap["platform"], "github")
            self.assertEqual(snap["last_id"], 6)
            self.assertEqual(snap["pool_size"], 2)
            self.assertEqual(snap["total_users"], 0)
            self.assertFalse(snap["token_configured"])
            self.assertEqual(db.get_scrape_state(conn)["last_id"], 0)
        finally:
            conn.close()

    def test_pause_and_heartbeat_are_separate_from_devto(self):
        conn = _conn()
        try:
            db.set_scrape_paused(conn, True, "github")
            self.assertTrue(db.is_scrape_paused(conn, "github"))
            self.assertFalse(db.is_scrape_paused(conn))
            db.touch_scrape_heartbeat(conn, platform_id="github")
            self.assertIsNone(db.scrape_heartbeat_age_sec(conn))
            self.assertIsNotNone(db.scrape_heartbeat_age_sec(conn, platform_id="github"))
        finally:
            conn.close()

    def test_scraper_token_is_not_the_lookup_token(self):
        self.assertIsNot(github_scrape_token, github_token)

    def test_lookup_uses_the_caller_token(self):
        headers = github_headers("ghp_this_is_the_scraper_token")
        self.assertEqual(headers["Authorization"], "Bearer ghp_this_is_the_scraper_token")

    def test_investigated_user_merges_into_the_main_table_and_leaves_the_pool(self):
        conn = _conn()
        try:
            db.insert_github_accounts(
                conn,
                [{"github_id": 9, "login": "ada", "account_type": "User", "html_url": "https://github.com/ada"}],
            )
            country, location, blocked = apply_github_place("noloc", "", "Berlin, Germany")
            self.assertFalse(blocked)
            outcome = store_github_contact(
                conn,
                GithubPerson(
                    status="ok",
                    login="ada",
                    email="ada@example.com",
                    name="Ada Lovelace",
                    bio="math",
                    location="Berlin, Germany",
                    socials=[],
                ),
                source="github",
                link="https://github.com/ada",
                platform_user_id=9,
                country=country,
                location=location,
            )
            self.assertEqual(outcome, "saved")
            db.delete_github_account(conn, 9)
            row = conn.execute("SELECT source, github, country FROM users").fetchone()
            self.assertEqual(row["source"], "github")
            self.assertEqual(row["github"], "ada")
            self.assertEqual(row["country"], "germany")
            self.assertEqual(db.list_github_pool(conn), [])
            self.assertEqual(db.count_users_from_source(conn, "github"), 1)
            again = store_github_contact(
                conn,
                GithubPerson(status="ok", login="ada", email="ada@example.com", name="Ada"),
                source="github",
                link="https://github.com/ada",
                platform_user_id=9,
                country="germany",
                location="Berlin, DEU",
            )
            self.assertEqual(again, "duplicate")
            self.assertEqual(conn.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"], 1)
        finally:
            conn.close()

    def test_github_scraper_takes_over_the_same_username_saved_from_devto(self):
        conn = _conn()
        try:
            db.insert_user(
                conn,
                email="old@example.com",
                name="Ada",
                link="https://dev.to/ada",
                github="ada",
                location="Berlin, DEU",
                country="germany",
                source="devto",
                platform_user_id=4,
            )
            outcome = save_github_contact(
                conn,
                GithubPerson(
                    status="ok",
                    login="Ada",
                    email="new@example.com",
                    name="Ada Lovelace",
                    location="Reykjavik, Iceland",
                    socials=[],
                ),
                source="github",
                link="https://github.com/ada",
                platform_user_id=9,
                prior_country="germany",
                prior_location="Berlin, DEU",
            )
            self.assertEqual(outcome, "duplicate")
            row = conn.execute(
                "SELECT source, link, platform_user_id, email, country, location FROM users"
            ).fetchone()
            self.assertEqual(row["source"], "github")
            self.assertEqual(row["link"], "https://github.com/ada")
            self.assertEqual(row["platform_user_id"], "9")
            self.assertEqual(row["email"], "new@example.com")
            self.assertEqual(row["country"], "germany")
            self.assertEqual(row["location"], "Berlin, DEU")
            self.assertEqual(conn.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"], 1)
        finally:
            conn.close()

    def test_devto_leaves_a_github_scraper_row_in_place(self):
        conn = _conn()
        try:
            db.insert_user(
                conn,
                email="ada@example.com",
                name="Ada Lovelace",
                link="https://github.com/ada",
                github="ada",
                location="Berlin, DEU",
                country="germany",
                source="github",
                platform_user_id=9,
            )
            outcome = save_github_contact(
                conn,
                GithubPerson(
                    status="ok",
                    login="ada",
                    email="other@example.com",
                    name="Someone Else",
                    location="Paris, France",
                    socials=[],
                ),
                source="devto",
                link="https://dev.to/ada",
                platform_user_id=4,
                prior_country="france",
                prior_location="Paris, FRA",
                name="Devto Name",
            )
            self.assertEqual(outcome, "duplicate")
            row = conn.execute(
                "SELECT source, link, email, country, platform_user_id FROM users"
            ).fetchone()
            self.assertEqual(row["source"], "github")
            self.assertEqual(row["link"], "https://github.com/ada")
            self.assertEqual(row["email"], "ada@example.com")
            self.assertEqual(row["country"], "germany")
            self.assertEqual(row["platform_user_id"], "9")
        finally:
            conn.close()

    def test_blocked_country_removes_the_username_when_the_github_scraper_finds_it(self):
        conn = _conn()
        try:
            db.insert_user(
                conn,
                email="ada@example.com",
                name="Ada",
                link="https://dev.to/ada",
                github="ada",
                location="",
                country="noloc",
                source="devto",
                platform_user_id=4,
            )
            outcome = save_github_contact(
                conn,
                GithubPerson(
                    status="ok",
                    login="ada",
                    email="ada@example.com",
                    name="Ada",
                    location="Reykjavik, Iceland",
                    socials=[],
                ),
                source="github",
                link="https://github.com/ada",
                platform_user_id=9,
                prior_country="noloc",
                prior_location="",
            )
            self.assertEqual(outcome, "skipped")
            self.assertEqual(conn.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"], 0)
        finally:
            conn.close()

    def test_devto_does_not_drop_a_github_row_for_a_blocked_place(self):
        conn = _conn()
        try:
            db.insert_user(
                conn,
                email="ada@example.com",
                name="Ada",
                link="https://github.com/ada",
                github="ada",
                location="Berlin, DEU",
                country="germany",
                source="github",
                platform_user_id=9,
            )
            outcome = save_github_contact(
                conn,
                GithubPerson(
                    status="ok",
                    login="ada",
                    email="ada@example.com",
                    location="Reykjavik, Iceland",
                    socials=[],
                ),
                source="devto",
                link="https://dev.to/ada",
                platform_user_id=4,
                prior_country="noloc",
                prior_location="",
            )
            self.assertEqual(outcome, "duplicate")
            self.assertEqual(conn.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"], 1)
            self.assertEqual(
                conn.execute("SELECT country FROM users").fetchone()["country"],
                "germany",
            )
        finally:
            conn.close()

    def test_new_user_without_a_telegram_account_is_marked_failed(self):
        conn = _conn()
        try:
            with patch("core.github_lookup.live_lookup", return_value=lambda handle: "missing"):
                outcome = store_github_contact(
                    conn,
                    GithubPerson(
                        status="ok",
                        login="ada",
                        email="ada@example.com",
                        name="Ada",
                        socials=[{
                            "provider": "x",
                            "url": "https://x.com/ada_name",
                            "status": "not_sent",
                        }],
                    ),
                    source="github",
                    link="https://github.com/ada",
                    platform_user_id=9,
                    country="germany",
                    location="Berlin, DEU",
                )
            self.assertEqual(outcome, "saved")
            links = db.load_social_links(
                conn.execute("SELECT socials FROM users").fetchone()["socials"]
            )
            self.assertEqual(links[0]["status"], "failed")
        finally:
            conn.close()


class NolocWithoutSocialTests(unittest.TestCase):
    def test_email_and_github_without_a_place_or_social_is_not_saved(self):
        conn = _conn()
        try:
            for source, link in (
                ("github", "https://github.com/ada"),
                ("devto", "https://dev.to/ada"),
            ):
                outcome = save_github_contact(
                    conn,
                    GithubPerson(
                        status="ok",
                        login="ada",
                        email="ada@example.com",
                        name="Ada",
                        location="",
                        socials=[],
                    ),
                    source=source,
                    link=link,
                    platform_user_id=9,
                    prior_country="noloc",
                    prior_location="",
                )
                self.assertEqual(outcome, "noloc")
            self.assertEqual(conn.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"], 0)
        finally:
            conn.close()

    def test_noloc_with_a_social_link_is_saved(self):
        conn = _conn()
        try:
            outcome = save_github_contact(
                conn,
                GithubPerson(
                    status="ok",
                    login="ada",
                    email="ada@example.com",
                    name="Ada",
                    location="",
                    socials=[{
                        "provider": "linkedin",
                        "url": "https://linkedin.com/in/ada",
                        "status": "not_sent",
                    }],
                ),
                source="github",
                link="https://github.com/ada",
                platform_user_id=9,
                prior_country="noloc",
                prior_location="",
            )
            self.assertEqual(outcome, "saved")
            row = conn.execute("SELECT country FROM users").fetchone()
            self.assertEqual(row["country"], "noloc")
        finally:
            conn.close()

    def test_a_github_place_still_saves_without_socials(self):
        conn = _conn()
        try:
            outcome = save_github_contact(
                conn,
                GithubPerson(
                    status="ok",
                    login="ada",
                    email="ada@example.com",
                    name="Ada",
                    location="Berlin, Germany",
                    socials=[],
                ),
                source="devto",
                link="https://dev.to/ada",
                platform_user_id=4,
                prior_country="noloc",
                prior_location="",
            )
            self.assertEqual(outcome, "saved")
            self.assertEqual(
                conn.execute("SELECT country FROM users").fetchone()["country"],
                "germany",
            )
        finally:
            conn.close()

    def test_existing_noloc_rows_without_socials_are_removed_once(self):
        conn = _conn()
        try:
            db.insert_user(
                conn, email="gh@example.com", name="Gh", link="https://github.com/gh",
                github="gh", location="", country="noloc", source="github", platform_user_id=1,
            )
            db.insert_user(
                conn, email="dev@example.com", name="Dev", link="https://dev.to/dev",
                github="dev", location="", country="noloc", source="devto", platform_user_id=2,
            )
            kept_id = db.insert_user(
                conn, email="soc@example.com", name="Soc", link="https://github.com/soc",
                github="soc", location="", country="noloc", source="github", platform_user_id=3,
            )[1]
            conn.execute(
                "UPDATE users SET socials = ? WHERE id = ?",
                (
                    '[{"provider":"x","url":"https://x.com/soc","status":"not_sent"}]',
                    kept_id,
                ),
            )
            db.insert_user(
                conn, email="placed@example.com", name="Placed", link="https://dev.to/placed",
                github="placed", location="Berlin, DEU", country="germany", source="devto",
                platform_user_id=4,
            )
            db.ensure_drop_noloc_without_socials(conn)
            db.ensure_drop_noloc_without_socials(conn)
            emails = {
                row["email"]
                for row in conn.execute("SELECT email FROM users").fetchall()
            }
            self.assertEqual(emails, {"soc@example.com", "placed@example.com"})
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main()
