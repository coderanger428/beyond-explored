import sqlite3
import tempfile
import unittest
from pathlib import Path

import core.db as db


def _conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(db.SCHEMA_SQL)
    return conn


class FavoriteUserTests(unittest.TestCase):
    def test_heart_toggles_and_country_count_follows(self):
        conn = _conn()
        try:
            _, user_id = db.insert_user(
                conn,
                email="ada@example.com",
                name="Ada",
                link="",
                location="",
                country="japan",
            )
            marked = db.set_user_favorite(conn, user_id, True)
            self.assertEqual(marked["favorite"], 1)
            stats = {row["country"]: row for row in db.country_stats(conn)}
            self.assertEqual(stats["japan"]["favorites"], 1)

            cleared = db.set_user_favorite(conn, user_id, False)
            self.assertEqual(cleared["favorite"], 0)
            stats = {row["country"]: row for row in db.country_stats(conn)}
            self.assertEqual(stats["japan"]["favorites"], 0)
            self.assertIsNone(db.set_user_favorite(conn, 999, True))
        finally:
            conn.close()

    def test_existing_database_gains_the_column(self):
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        try:
            conn.execute(
                """
                CREATE TABLE users (
                    id INTEGER PRIMARY KEY,
                    email TEXT NOT NULL,
                    country TEXT NOT NULL
                )
                """
            )
            conn.execute(
                "INSERT INTO users (email, country) VALUES ('ada@example.com', 'japan')"
            )
            db.ensure_favorite_column(conn)
            row = conn.execute("SELECT favorite FROM users").fetchone()
            self.assertEqual(row["favorite"], 0)
        finally:
            conn.close()

    def test_startup_adds_favorite_before_indexing_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            old_schema = db.SCHEMA_SQL.replace(
                "    favorite INTEGER NOT NULL DEFAULT 0,\n",
                "",
            )
            conn = sqlite3.connect(root / "app.db")
            try:
                conn.executescript(old_schema)
                conn.execute(
                    """
                    INSERT INTO users (
                        email, name, country, created_at, updated_at
                    ) VALUES (
                        'ada@example.com', 'Ada', 'japan',
                        '2026-11-01T00:00:00+09:00', '2026-11-01T00:00:00+09:00'
                    )
                    """
                )
                conn.commit()
            finally:
                conn.close()

            db.init_db(root)
            conn = db.connect(root)
            try:
                row = conn.execute(
                    "SELECT favorite FROM users WHERE email = 'ada@example.com'"
                ).fetchone()
                self.assertEqual(row["favorite"], 0)
                stats = {item["country"]: item for item in db.country_stats(conn)}
                self.assertEqual(stats["japan"]["favorites"], 0)
            finally:
                conn.close()


if __name__ == "__main__":
    unittest.main()
