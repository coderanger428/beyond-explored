import json
import sqlite3
import unittest

import core.db as db


def _conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(db.SCHEMA_SQL)
    return conn


def _user(conn, email="ada@example.com", **kwargs):
    inserted, user_id = db.insert_user(
        conn,
        email=email,
        name=kwargs.get("name", "Ada"),
        link=kwargs.get("link", "https://dev.to/ada"),
        location=kwargs.get("location", "Berlin, DEU"),
        country=kwargs.get("country", "germany"),
        source=kwargs.get("source", "devto"),
        github=kwargs.get("github", ""),
    )
    assert inserted
    return user_id


class UserProfileTests(unittest.TestCase):
    def test_saves_name_email_place_github_and_links(self):
        conn = _conn()
        try:
            user_id = _user(conn, github="oldname")
            result = db.update_user_profile(
                conn,
                user_id,
                display_name="August",
                email="august@example.com",
                location="Berlin, Germany",
                github="https://github.com/August",
                socials=["https://www.linkedin.com/in/august", "t.me/august_one"],
            )
            self.assertEqual(result["action"], "save")
            user = result["user"]
            self.assertEqual(user["display_name"], "August")
            self.assertEqual(user["email"], "august@example.com")
            self.assertEqual(user["location"], "Berlin, DEU")
            self.assertEqual(user["country"], "germany")
            self.assertEqual(user["github"], "August")
            self.assertEqual(user["source"], "devto,github")
            self.assertEqual(user["link"], "https://dev.to/ada")
            links = json.loads(user["socials"])
            self.assertEqual(
                [(item["provider"], item["status"]) for item in links],
                [("linkedin", "not_sent"), ("telegram", "not_sent")],
            )
        finally:
            conn.close()

    def test_unchanged_link_keeps_status_and_a_removed_link_is_gone(self):
        conn = _conn()
        try:
            user_id = _user(conn)
            conn.execute(
                "UPDATE users SET socials = ? WHERE id = ?",
                (
                    json.dumps([
                        {"provider": "x", "url": "https://x.com/ada", "status": "sent"},
                        {"provider": "telegram", "url": "https://t.me/ada_one", "status": "failed"},
                        {"provider": "reddit", "url": "https://reddit.com/user/ada", "status": "not_sent"},
                    ]),
                    user_id,
                ),
            )
            result = db.update_user_profile(
                conn,
                user_id,
                display_name="Ada",
                email="ada@example.com",
                location="Berlin, DEU",
                github="",
                socials=[
                    "https://twitter.com/ada",
                    "https://telegram.me/ada_one",
                    "https://mastodon.social/@ada",
                ],
            )
            links = {
                item["provider"]: item["status"]
                for item in json.loads(result["user"]["socials"])
            }
            self.assertEqual(links["x"], "sent")
            self.assertEqual(links["telegram"], "failed")
            self.assertEqual(links["mastodon"], "not_sent")
            self.assertNotIn("reddit", links)
        finally:
            conn.close()

    def test_duplicate_email_is_rejected(self):
        conn = _conn()
        try:
            first = _user(conn, "ada@example.com")
            _user(conn, "other@example.com")
            with self.assertRaises(ValueError):
                db.update_user_profile(
                    conn,
                    first,
                    display_name="Ada",
                    email="Other@example.com",
                    location="Berlin, DEU",
                    github="",
                    socials=[],
                )
        finally:
            conn.close()

    def test_github_and_devto_links_are_not_socials(self):
        conn = _conn()
        try:
            user_id = _user(conn)
            with self.assertRaises(ValueError):
                db.update_user_profile(
                    conn,
                    user_id,
                    display_name="Ada",
                    email="ada@example.com",
                    location="Berlin, DEU",
                    github="",
                    socials=["https://github.com/ada"],
                )
            with self.assertRaises(ValueError):
                db.update_user_profile(
                    conn,
                    user_id,
                    display_name="Ada",
                    email="ada@example.com",
                    location="Berlin, DEU",
                    github="",
                    socials=["https://dev.to/ada"],
                )
        finally:
            conn.close()

    def test_excluded_location_deletes_without_other_edits(self):
        conn = _conn()
        try:
            user_id = _user(conn)
            result = db.update_user_profile(
                conn,
                user_id,
                display_name="Gone",
                email="gone@example.com",
                location="Iceland",
                github="someone",
                socials=["https://linkedin.com/in/gone"],
            )
            self.assertEqual(result["action"], "delete")
            self.assertIsNone(result["user"])
            row = conn.execute("SELECT email, display_name FROM users WHERE id = ?", (user_id,)).fetchone()
            self.assertIsNone(row)
        finally:
            conn.close()

    def test_sent_mail_keeps_the_display_name(self):
        conn = _conn()
        try:
            user_id = _user(conn)
            conn.execute(
                "UPDATE users SET display_name = ?, mail_status = 'sent' WHERE id = ?",
                ("Ada", user_id),
            )
            with self.assertRaises(ValueError):
                db.update_user_profile(
                    conn,
                    user_id,
                    display_name="August",
                    email="ada@example.com",
                    location="Berlin, DEU",
                    github="",
                    socials=[],
                )
            kept = db.update_user_profile(
                conn,
                user_id,
                display_name="Ada",
                email="ada@example.com",
                location="Berlin, DEU",
                github="",
                socials=[],
            )
            self.assertEqual(kept["user"]["display_name"], "Ada")
            self.assertEqual(kept["user"]["mail_status"], "sent")
        finally:
            conn.close()

    def test_clearing_github_drops_it_from_a_devto_source(self):
        conn = _conn()
        try:
            user_id = _user(conn, github="ada")
            self.assertEqual(
                conn.execute("SELECT source FROM users WHERE id = ?", (user_id,)).fetchone()["source"],
                "devto,github",
            )
            result = db.update_user_profile(
                conn,
                user_id,
                display_name="Ada",
                email="ada@example.com",
                location="Berlin, DEU",
                github="",
                socials=[],
            )
            self.assertEqual(result["user"]["github"], "")
            self.assertEqual(result["user"]["source"], "devto")
            self.assertEqual(result["user"]["link"], "https://dev.to/ada")
        finally:
            conn.close()

    def test_github_origin_follows_the_username(self):
        conn = _conn()
        try:
            user_id = _user(
                conn,
                source="github",
                github="ada",
                link="https://github.com/ada",
            )
            result = db.update_user_profile(
                conn,
                user_id,
                display_name="Ada",
                email="ada@example.com",
                location="Berlin, DEU",
                github="ada-new",
                socials=[],
            )
            self.assertEqual(result["user"]["github"], "ada-new")
            self.assertEqual(result["user"]["link"], "https://github.com/ada-new")
            self.assertEqual(result["user"]["source"], "github")
            with self.assertRaises(ValueError):
                db.update_user_profile(
                    conn,
                    user_id,
                    display_name="Ada",
                    email="ada@example.com",
                    location="Berlin, DEU",
                    github="",
                    socials=[],
                )
        finally:
            conn.close()

    def test_unknown_location_and_missing_user(self):
        conn = _conn()
        try:
            user_id = _user(conn)
            with self.assertRaises(Exception):
                db.update_user_profile(
                    conn,
                    user_id,
                    display_name="Ada",
                    email="ada@example.com",
                    location="zzzz-not-a-place",
                    github="",
                    socials=[],
                )
            self.assertIsNone(
                db.update_user_profile(
                    conn,
                    999,
                    display_name="Ada",
                    email="ada@example.com",
                    location="Berlin, DEU",
                    github="",
                    socials=[],
                )
            )
        finally:
            conn.close()


class UserFieldSaveTests(unittest.TestCase):
    def test_email_and_github_save_on_their_own(self):
        conn = _conn()
        try:
            user_id = _user(conn, github="ada")
            other = _user(conn, "other@example.com")
            saved = db.update_user_email(conn, user_id, "Ada.New@example.com")
            self.assertEqual(saved["email"], "Ada.New@example.com")
            self.assertEqual(saved["github"], "ada")
            with self.assertRaises(ValueError):
                db.update_user_email(conn, user_id, "other@example.com")
            renamed = db.update_user_github_login(conn, user_id, "https://github.com/Ada-New")
            self.assertEqual(renamed["github"], "Ada-New")
            self.assertEqual(renamed["source"], "devto,github")
            self.assertEqual(renamed["link"], "https://dev.to/ada")
            cleared = db.update_user_github_login(conn, user_id, "")
            self.assertEqual(cleared["github"], "")
            self.assertEqual(cleared["source"], "devto")
            self.assertIsNotNone(other)
        finally:
            conn.close()

    def test_links_save_one_at_a_time(self):
        conn = _conn()
        try:
            user_id = _user(conn)
            conn.execute(
                "UPDATE users SET socials = ? WHERE id = ?",
                (
                    json.dumps([
                        {"provider": "x", "url": "https://x.com/ada", "status": "sent"},
                    ]),
                    user_id,
                ),
            )
            added = db.add_user_social_link(conn, user_id, "t.me/ada_one")
            links = {item["provider"]: item for item in json.loads(added["socials"])}
            self.assertEqual(links["telegram"]["status"], "not_sent")
            self.assertEqual(links["x"]["status"], "sent")
            with self.assertRaises(ValueError):
                db.add_user_social_link(conn, user_id, "https://telegram.me/ada_one")
            with self.assertRaises(ValueError):
                db.add_user_social_link(conn, user_id, "https://github.com/ada")
            replaced = db.replace_user_social_link(
                conn,
                user_id,
                "https://twitter.com/ada",
                "https://x.com/ada",
            )
            kept = {item["provider"]: item["status"] for item in json.loads(replaced["socials"])}
            self.assertEqual(kept["x"], "sent")
            changed = db.replace_user_social_link(
                conn,
                user_id,
                "https://x.com/ada",
                "https://x.com/ada_new",
            )
            moved = {item["url"]: item["status"] for item in json.loads(changed["socials"])}
            self.assertEqual(moved["https://x.com/ada_new"], "not_sent")
            removed = db.remove_user_social_link(conn, user_id, "https://t.me/ada_one")
            providers = [item["provider"] for item in json.loads(removed["socials"])]
            self.assertNotIn("telegram", providers)
            self.assertIn("x", providers)
        finally:
            conn.close()
