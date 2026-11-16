import sqlite3
import unittest

from core.locations import UnknownLocation
import core.db as db


def _conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(db.SCHEMA_SQL)
    return conn


def _user(conn, email, location, country):
    _, user_id = db.insert_user(
        conn,
        email=email,
        name=email.split("@")[0],
        link="",
        location=location,
        country=country,
    )
    return user_id


class ApplyUserLocationTests(unittest.TestCase):
    def test_save_rewrites_place_and_country(self):
        conn = _conn()
        try:
            user_id = _user(conn, "ada@gmail.com", "Berlin, DEU", "germany")
            result = db.apply_user_location(conn, user_id, "Austin, Texas")
            self.assertEqual(result["action"], "save")
            self.assertEqual(result["user"]["location"], "Austin, TX")
            self.assertEqual(result["user"]["country"], "usa")
            self.assertIsNone(db.apply_user_location(conn, 999, "Austin, Texas"))
        finally:
            conn.close()

    def test_blank_moves_the_user_to_noloc(self):
        conn = _conn()
        try:
            user_id = _user(conn, "ada@gmail.com", "Berlin, DEU", "germany")
            result = db.apply_user_location(conn, user_id, "  ")
            self.assertEqual(result["action"], "save")
            self.assertEqual(result["user"]["location"], "")
            self.assertEqual(result["user"]["country"], "noloc")
        finally:
            conn.close()

    def test_unknown_text_leaves_the_row(self):
        conn = _conn()
        try:
            user_id = _user(conn, "ada@gmail.com", "Berlin, DEU", "germany")
            with self.assertRaises(UnknownLocation):
                db.apply_user_location(conn, user_id, "not a real place xyzzy")
            row = conn.execute(
                "SELECT location, country FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()
            self.assertEqual(row["location"], "Berlin, DEU")
            self.assertEqual(row["country"], "germany")
        finally:
            conn.close()

    def test_excluded_country_deletes_the_user_and_queue_row(self):
        conn = _conn()
        try:
            user_id = _user(conn, "ada@gmail.com", "Austin, TX", "usa")
            conn.execute(
                """
                INSERT INTO queue_items (user_id, status, queued_at)
                VALUES (?, 'queued', ?)
                """,
                (user_id, db.utc_now()),
            )
            result = db.apply_user_location(conn, user_id, "Seoul, South Korea")
            self.assertEqual(result["action"], "delete")
            self.assertIsNone(result["user"])
            self.assertIsNone(
                conn.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
            )
            self.assertIsNone(
                conn.execute(
                    "SELECT id FROM queue_items WHERE user_id = ?",
                    (user_id,),
                ).fetchone()
            )
        finally:
            conn.close()

    def test_suppressing_one_user_leaves_the_next_user(self):
        conn = _conn()
        try:
            marked_id = _user(conn, "ada@gmail.com", "Berlin, Germany", "germany")
            hidden = db.suppress_user(conn, marked_id)
            self.assertEqual(hidden["suppressed"], 1)

            other_id = _user(conn, "grace@gmail.com", "Austin, TX", "usa")
            result = db.apply_user_location(conn, other_id, "Berlin, Germany")
            self.assertEqual(result["action"], "save")
            self.assertEqual(result["user"]["location"], "Berlin, DEU")
            self.assertEqual(result["user"]["country"], "germany")
            other = conn.execute(
                "SELECT suppressed FROM users WHERE id = ?",
                (other_id,),
            ).fetchone()
            self.assertEqual(other["suppressed"], 0)
            still = conn.execute(
                "SELECT suppressed FROM users WHERE id = ?",
                (marked_id,),
            ).fetchone()
            self.assertEqual(still["suppressed"], 1)
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main()
