import sqlite3
import unittest

import core.db as db
from core.telegram_lookup import (
    check_telegram_handles,
    social_handle,
    telegram_page_state,
)


def _conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(db.SCHEMA_SQL)
    return conn


def _user(conn, email, socials):
    now = "2026-11-08T00:00:00+09:00"
    conn.execute(
        """
        INSERT INTO users (
            email, name, link, location, country, socials, mail_status, created_at, updated_at
        ) VALUES (?, 'Ada', 'https://dev.to/ada', 'US', 'usa', ?, 'not_sent', ?, ?)
        """,
        (email, socials, now, now),
    )
    return conn.execute(
        "SELECT id FROM users WHERE email = ?", (email,)
    ).fetchone()["id"]


def _statuses(conn, user_id):
    raw = conn.execute(
        "SELECT socials FROM users WHERE id = ?", (user_id,)
    ).fetchone()["socials"]
    return {
        item["url"]: item["status"]
        for item in db.load_social_links(raw)
    }


class TelegramPageTests(unittest.TestCase):
    def test_public_account_page_exists(self):
        html = "<title>Telegram: View @ada</title><div class='tgme_page_extra'>@ada</div>"
        self.assertEqual(telegram_page_state(html), "exists")

    def test_contact_shell_is_missing(self):
        html = "<title>Telegram: Contact @missing_name</title><div class='tgme_page_description'></div>"
        self.assertEqual(telegram_page_state(html), "missing")

    def test_unrecognized_page_is_unknown(self):
        self.assertEqual(telegram_page_state("<title>Telegram Messenger</title>"), "unknown")


class TelegramCheckTests(unittest.TestCase):
    def test_username_comes_from_the_last_path_segment(self):
        self.assertEqual(social_handle("x", "https://x.com/users/user123"), "user123")
        self.assertEqual(social_handle("npm", "https://www.npmjs.com/~ada"), "ada")
        self.assertEqual(social_handle("linkedin", "https://linkedin.com/in/ada"), "")

    def test_missing_username_marks_that_social_failed(self):
        conn = _conn()
        try:
            user_id = _user(
                conn,
                "ada@example.com",
                '[{"provider":"x","url":"https://x.com/ada_name","status":"not_sent"},'
                '{"provider":"linkedin","url":"https://linkedin.com/in/ada","status":"not_sent"}]',
            )
            result = check_telegram_handles(conn, [user_id], lambda handle: "missing")
            self.assertEqual(result["failed"], 1)
            self.assertEqual(result["found"], 0)
            statuses = _statuses(conn, user_id)
            self.assertEqual(statuses["https://x.com/ada_name"], "failed")
            self.assertEqual(statuses["https://linkedin.com/in/ada"], "not_sent")
        finally:
            conn.close()

    def test_existing_account_stays_untouched(self):
        conn = _conn()
        try:
            user_id = _user(
                conn,
                "ada@example.com",
                '[{"provider":"x","url":"https://x.com/ada_name","status":"not_sent"}]',
            )
            result = check_telegram_handles(conn, [user_id], lambda handle: "exists")
            self.assertEqual(result["found"], 1)
            self.assertEqual(result["failed"], 0)
            self.assertEqual(_statuses(conn, user_id)["https://x.com/ada_name"], "not_sent")
            self.assertEqual(result["users"], [])
        finally:
            conn.close()

    def test_sent_link_and_saved_telegram_are_left_alone(self):
        conn = _conn()
        try:
            sent_id = _user(
                conn,
                "sent@example.com",
                '[{"provider":"x","url":"https://x.com/ada_name","status":"sent"}]',
            )
            saved_id = _user(
                conn,
                "saved@example.com",
                '[{"provider":"x","url":"https://x.com/ada_name","status":"not_sent"},'
                '{"provider":"telegram","url":"https://t.me/ada_name","status":"not_sent"}]',
            )
            calls = []
            result = check_telegram_handles(
                conn,
                [sent_id, saved_id],
                lambda handle: calls.append(handle) or "missing",
            )
            self.assertEqual(calls, [])
            self.assertEqual(result["checked"], 0)
            self.assertEqual(_statuses(conn, sent_id)["https://x.com/ada_name"], "sent")
            self.assertEqual(_statuses(conn, saved_id)["https://x.com/ada_name"], "not_sent")
        finally:
            conn.close()

    def test_impossible_handle_fails_without_a_lookup(self):
        conn = _conn()
        try:
            user_id = _user(
                conn,
                "short@example.com",
                '[{"provider":"x","url":"https://x.com/ab","status":"not_sent"}]',
            )
            def unexpected(handle):
                raise AssertionError(handle)

            result = check_telegram_handles(conn, [user_id], unexpected)
            self.assertEqual(result["failed"], 1)
            self.assertEqual(_statuses(conn, user_id)["https://x.com/ab"], "failed")
        finally:
            conn.close()

    def test_unknown_answer_does_not_mark_failed(self):
        conn = _conn()
        try:
            user_id = _user(
                conn,
                "ada@example.com",
                '[{"provider":"instagram","url":"https://instagram.com/ada_name","status":"not_sent"}]',
            )
            result = check_telegram_handles(conn, [user_id], lambda handle: "unknown")
            self.assertEqual(result["unknown"], 1)
            self.assertEqual(result["failed"], 0)
            self.assertEqual(
                _statuses(conn, user_id)["https://instagram.com/ada_name"],
                "not_sent",
            )
        finally:
            conn.close()
