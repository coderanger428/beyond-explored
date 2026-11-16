import json
import sqlite3
import unittest

import core.db as db


def _conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(db.SCHEMA_SQL)
    return conn


def _user(conn, email, mail_status="not_sent"):
    now = "2026-10-27T00:00:00+09:00"
    conn.execute(
        """
        INSERT INTO users (
            email, name, link, location, country, mail_status, created_at, updated_at
        ) VALUES (?, 'Ada', 'https://dev.to/ada', 'US', 'usa', ?, ?, ?)
        """,
        (email, mail_status, now, now),
    )
    return conn.execute(
        "SELECT id FROM users WHERE email = ?", (email,)
    ).fetchone()["id"]


class ManualContactTests(unittest.TestCase):
    def test_queued_mail_returns_to_untouched_and_passwords_clear_once(self):
        conn = _conn()
        try:
            conn.execute("ALTER TABLE users DROP COLUMN social_status")
            user_id = _user(conn, "queued@gmail.com", "sending")
            now = "2026-10-27T00:00:00+09:00"
            conn.execute(
                """
                INSERT INTO mail_accounts (
                    email, app_password, active, daily_cap, created_at, updated_at
                ) VALUES ('from@gmail.com', 'secret-app-password', 1, 20, ?, ?)
                """,
                (now, now),
            )
            db.ensure_manual_contact(conn)
            row = conn.execute(
                "SELECT mail_status, social_status FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()
            self.assertEqual(row["mail_status"], "not_sent")
            self.assertEqual(row["social_status"], "not_sent")
            password = conn.execute(
                "SELECT app_password FROM mail_accounts"
            ).fetchone()["app_password"]
            self.assertEqual(password, "")

            conn.execute(
                "UPDATE mail_accounts SET app_password = 'typed-later'"
            )
            db.ensure_manual_contact(conn)
            password = conn.execute(
                "SELECT app_password FROM mail_accounts"
            ).fetchone()["app_password"]
            self.assertEqual(password, "typed-later")
        finally:
            conn.close()

    def test_sent_mail_stores_sender_and_failed_keeps_it(self):
        conn = _conn()
        try:
            user_id = _user(conn, "ada@gmail.com")
            with self.assertRaises(ValueError):
                db.set_user_contact(
                    conn, user_id, channel="email", status="sent", sender_email="  "
                )
            saved = db.set_user_contact(
                conn,
                user_id,
                channel="email",
                status="sent",
                sender_email="from@gmail.com",
                template="usa (1).txt",
            )
            self.assertEqual(saved["mail_status"], "sent")
            self.assertEqual(saved["sender_email"], "from@gmail.com")
            self.assertEqual(saved["mail_template"], "usa (1).txt")

            failed = db.set_user_contact(
                conn,
                user_id,
                channel="email",
                status="failed",
                template="eu (1).txt",
            )
            self.assertEqual(failed["mail_status"], "failed")
            self.assertEqual(failed["sender_email"], "from@gmail.com")
            self.assertEqual(failed["mail_template"], "eu (1).txt")

            cleared = db.set_user_contact(
                conn, user_id, channel="email", status="not_sent", template="usa (1).txt"
            )
            self.assertEqual(cleared["mail_status"], "not_sent")
            self.assertEqual(cleared["mail_template"], "")
        finally:
            conn.close()

    def test_each_social_link_keeps_its_own_status(self):
        conn = _conn()
        try:
            user_id = _user(conn, "social@gmail.com", "sent")
            conn.execute(
                "UPDATE users SET socials = ? WHERE id = ?",
                (
                    '[{"provider":"linkedin","url":"https://linkedin.com/in/ada"},'
                    '{"provider":"telegram","url":"https://t.me/ada"}]',
                    user_id,
                ),
            )
            saved = db.set_user_contact(
                conn,
                user_id,
                channel="social",
                status="sent",
                social_url="https://linkedin.com/in/ada/",
            )
            links = json.loads(saved["socials"])
            self.assertEqual(links[0]["status"], "sent")
            self.assertEqual(links[1]["status"], "not_sent")
            self.assertEqual(saved["mail_status"], "sent")

            cleared = db.set_user_contact(
                conn,
                user_id,
                channel="social",
                status="not_sent",
                social_url="https://linkedin.com/in/ada",
            )
            self.assertEqual(json.loads(cleared["socials"])[0]["status"], "not_sent")
            with self.assertRaises(ValueError):
                db.set_user_contact(conn, user_id, channel="social", status="failed")
            self.assertIsNone(
                db.set_user_contact(
                    conn,
                    999,
                    channel="social",
                    status="failed",
                    social_url="https://linkedin.com/in/ada",
                )
            )
        finally:
            conn.close()

    def test_profile_refresh_keeps_a_link_status(self):
        conn = _conn()
        try:
            user_id = _user(conn, "refresh@gmail.com")
            conn.execute(
                "UPDATE users SET socials = ? WHERE id = ?",
                (
                    '[{"provider":"linkedin","url":"https://linkedin.com/in/ada","status":"failed"}]',
                    user_id,
                ),
            )
            db.update_github_profile(
                conn,
                user_id,
                bio="",
                github_name="",
                socials=[
                    {"provider": "linkedin", "url": "https://linkedin.com/in/ada", "status": "not_sent"},
                    {"provider": "x", "url": "https://x.com/ada", "status": "not_sent"},
                ],
            )
            links = json.loads(
                conn.execute("SELECT socials FROM users WHERE id = ?", (user_id,)).fetchone()["socials"]
            )
            self.assertEqual(links[0]["status"], "failed")
            self.assertEqual(links[1], {"provider": "x", "url": "https://x.com/ada", "status": "not_sent"})
        finally:
            conn.close()

    def test_old_user_status_is_copied_onto_each_link_once(self):
        conn = _conn()
        try:
            user_id = _user(conn, "old@gmail.com")
            conn.execute(
                "UPDATE users SET social_status = 'sent', socials = ? WHERE id = ?",
                ('[{"provider":"discord","url":"https://discord.gg/ada"}]', user_id),
            )
            db.ensure_social_link_status(conn)
            db.ensure_social_link_status(conn)
            links = json.loads(
                conn.execute("SELECT socials FROM users WHERE id = ?", (user_id,)).fetchone()["socials"]
            )
            self.assertEqual(links, [{"provider": "discord", "url": "https://discord.gg/ada", "status": "sent"}])
        finally:
            conn.close()

    def test_known_site_is_named_and_keeps_its_status(self):
        conn = _conn()
        try:
            user_id = _user(conn, "sites@gmail.com")
            conn.execute(
                "UPDATE users SET socials = ? WHERE id = ?",
                (
                    '['
                    '{"provider":"generic","url":"https://stackoverflow.com/users/1/ada","status":"failed"},'
                    '{"provider":"generic","url":"https://github.com/ada","status":"sent"}'
                    ']',
                    user_id,
                ),
            )
            db.ensure_social_provider_names(conn)
            db.ensure_social_provider_names(conn)
            links = json.loads(
                conn.execute("SELECT socials FROM users WHERE id = ?", (user_id,)).fetchone()["socials"]
            )
            self.assertEqual(
                links,
                [{"provider": "stackoverflow", "url": "https://stackoverflow.com/users/1/ada", "status": "failed"}],
            )
        finally:
            conn.close()

    def test_source_profile_is_removed_from_socials(self):
        conn = _conn()
        try:
            user_id = _user(conn, "source-link@gmail.com")
            conn.execute(
                "UPDATE users SET link = ?, github = ?, socials = ? WHERE id = ?",
                (
                    "https://dev.to/ada",
                    "ada",
                    '['
                    '{"provider":"devto","url":"https://dev.to/ada","status":"sent"},'
                    '{"provider":"x","url":"https://x.com/ada","status":"failed"}'
                    ']',
                    user_id,
                ),
            )
            db.ensure_drop_source_socials(conn)
            db.ensure_drop_source_socials(conn)
            links = json.loads(
                conn.execute("SELECT socials FROM users WHERE id = ?", (user_id,)).fetchone()["socials"]
            )
            self.assertEqual(
                links,
                [{"provider": "x", "url": "https://x.com/ada", "status": "failed"}],
            )
        finally:
            conn.close()

    def test_bio_links_append_without_replacing_saved_ones(self):
        conn = _conn()
        try:
            user_id = _user(conn, "bio@gmail.com")
            conn.execute(
                "UPDATE users SET github = ?, github_bio = ?, socials = ? WHERE id = ?",
                (
                    "ada",
                    "https://t.me/ada https://linkedin.com/in/ada",
                    '[{"provider":"x","url":"https://x.com/ada","status":"failed"}]',
                    user_id,
                ),
            )
            stored = db.peek_user_by_github(conn, "Ada")
            added = db.append_social_links(
                conn,
                int(stored["id"]),
                [
                    {"provider": "telegram", "url": "https://t.me/ada"},
                    {"provider": "x", "url": "https://x.com/ada"},
                    {"provider": "generic", "url": "https://ada.dev"},
                ],
            )
            self.assertEqual(added, 1)
            db.clear_github_bio(conn, user_id)
            bio = conn.execute(
                "SELECT github_bio FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()["github_bio"]
            self.assertEqual(bio, "")
            links = json.loads(
                conn.execute("SELECT socials FROM users WHERE id = ?", (user_id,)).fetchone()["socials"]
            )
            self.assertEqual(
                links,
                [
                    {"provider": "x", "url": "https://x.com/ada", "status": "failed"},
                    {"provider": "telegram", "url": "https://t.me/ada", "status": "not_sent"},
                ],
            )
        finally:
            conn.close()

    def test_telegram_link_uses_the_same_username(self):
        conn = _conn()
        try:
            user_id = _user(conn, "tgadd@gmail.com")
            user, added = db.add_telegram_link(conn, user_id, "@user123")
            self.assertTrue(added)
            links = json.loads(user["socials"])
            self.assertEqual(links, [{"provider": "telegram", "url": "https://t.me/user123", "status": "not_sent"}])
            again, added_again = db.add_telegram_link(conn, user_id, "user123")
            self.assertFalse(added_again)
            self.assertEqual(json.loads(again["socials"]), links)
            other, added_other = db.add_telegram_link(conn, user_id, "another_name")
            self.assertTrue(added_other)
            self.assertEqual(
                json.loads(other["socials"]),
                links + [{"provider": "telegram", "url": "https://t.me/another_name", "status": "not_sent"}],
            )
            with self.assertRaises(ValueError):
                db.add_telegram_link(conn, user_id, "bad name")
        finally:
            conn.close()

    def test_same_telegram_is_stored_once(self):
        links = db.dedupe_social_links([
            {"provider": "telegram", "url": "https://t.me/ptkdev", "status": "not_sent"},
            {"provider": "telegram", "url": "https://t.me/quizquickanswerbot", "status": "not_sent"},
            {"provider": "telegram", "url": "https://t.me/addstickers/ptkdev", "status": "not_sent"},
            {"provider": "telegram", "url": "http://t.me/Ptkdev", "status": "not_sent"},
            {"provider": "x", "url": "https://x.com/ptkdev", "status": "not_sent"},
            {"provider": "x", "url": "https://x.com/ptkdevio", "status": "not_sent"},
        ])
        self.assertEqual(
            [(item["provider"], item["url"]) for item in links],
            [
                ("telegram", "https://t.me/ptkdev"),
                ("telegram", "https://t.me/quizquickanswerbot"),
                ("x", "https://x.com/ptkdev"),
                ("x", "https://x.com/ptkdevio"),
            ],
        )

    def test_profile_refresh_keeps_a_hand_added_telegram_link(self):
        conn = _conn()
        try:
            user_id = _user(conn, "keep-tg@gmail.com")
            db.add_telegram_link(conn, user_id, "user123")
            db.update_github_profile(
                conn,
                user_id,
                bio="",
                github_name="",
                socials=[{"provider": "x", "url": "https://x.com/user123", "status": "not_sent"}],
            )
            links = json.loads(
                conn.execute("SELECT socials FROM users WHERE id = ?", (user_id,)).fetchone()["socials"]
            )
            self.assertEqual(
                links,
                [
                    {"provider": "x", "url": "https://x.com/user123", "status": "not_sent"},
                    {"provider": "telegram", "url": "https://t.me/user123", "status": "not_sent"},
                ],
            )
        finally:
            conn.close()

    def test_a_generic_fiverr_link_is_renamed(self):
        conn = _conn()
        try:
            user_id = _user(conn, "fiverr@gmail.com")
            conn.execute(
                "UPDATE users SET socials = ? WHERE id = ?",
                (
                    '[{"provider":"generic","url":"https://www.fiverr.com/ada","status":"not_sent"}]',
                    user_id,
                ),
            )
            db.ensure_refresh_social_provider_names(conn)
            db.ensure_refresh_social_provider_names(conn)
            links = json.loads(
                conn.execute("SELECT socials FROM users WHERE id = ?", (user_id,)).fetchone()["socials"]
            )
            self.assertEqual(links[0]["provider"], "fiverr")
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main()
