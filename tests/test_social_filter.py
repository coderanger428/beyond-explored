import json
import sqlite3
import unittest

import core.db as db
from server.dashboard import social_account_clauses


class SocialAccountClauseTests(unittest.TestCase):
    def test_unchecked_sends_no_sql(self):
        where, params = social_account_clauses([])
        self.assertEqual(where, [])
        self.assertEqual(params, [])

    def test_unknown_values_are_ignored(self):
        where, params = social_account_clauses(["github", "LINKEDIN", "linkedin"])
        self.assertEqual(params, ["linkedin"])
        self.assertEqual(len(where), 1)

    def test_whatsapp_is_accepted(self):
        where, params = social_account_clauses(["WhatsApp", "whatsapp"])
        self.assertEqual(params, ["whatsapp"])
        self.assertEqual(len(where), 1)

    def test_freelance_platforms_are_accepted(self):
        where, params = social_account_clauses(
            ["Fiverr", "guru", "Freelancer", "peopleperhour", "toptal", "contra", "malt", "workana"]
        )
        self.assertEqual(
            params,
            ["fiverr", "guru", "freelancer", "peopleperhour", "toptal", "contra", "malt", "workana"],
        )
        self.assertEqual(len(where), 1)

    def test_other_excludes_named_providers(self):
        where, params = social_account_clauses(["Other"])
        self.assertEqual(len(where), 1)
        self.assertEqual(where[0].count("?"), len(params))
        self.assertIn("linkedin", params)
        self.assertIn("workana", params)
        self.assertIn("github", params)
        self.assertIn(" NOT IN ", where[0])

    def test_upwork_and_x_are_accepted(self):
        where, params = social_account_clauses(["Upwork", "x", "github"])
        self.assertEqual(params, ["upwork", "x"])
        self.assertEqual(len(where), 1)
        self.assertIn(" OR ", where[0])

    def test_checked_platforms_are_ored(self):
        where, params = social_account_clauses(
            ["linkedin", "telegram", "discord"]
        )
        self.assertEqual(params, ["linkedin", "telegram", "discord"])
        self.assertEqual(len(where), 1)
        self.assertEqual(where[0].count(" OR "), 2)


class SocialAccountQueryTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(db.SCHEMA_SQL)
        now = "2026-10-24T00:00:00+09:00"
        rows = [
            (1, "li@gmail.com", [{"provider": "linkedin", "url": "https://linkedin.com/in/a"}]),
            (2, "tg@gmail.com", [{"provider": "telegram", "url": "https://t.me/a"}]),
            (
                3,
                "all@gmail.com",
                [
                    {"provider": "linkedin", "url": "https://linkedin.com/in/b"},
                    {"provider": "telegram", "url": "https://t.me/b"},
                    {"provider": "discord", "url": "https://discord.gg/b"},
                ],
            ),
            (4, "none@gmail.com", []),
            (5, "broken@gmail.com", None),
            (6, "wa@gmail.com", [{"provider": "whatsapp", "url": "https://wa.me/15551212"}]),
            (7, "uw@gmail.com", [{"provider": "upwork", "url": "https://www.upwork.com/freelancers/~ada"}]),
            (8, "xfail@gmail.com", [{"provider": "x", "url": "https://x.com/closed", "status": "failed"}]),
            (9, "xsent@gmail.com", [{"provider": "x", "url": "https://x.com/open", "status": "sent"}]),
            (10, "lifail@gmail.com", [{"provider": "linkedin", "url": "https://linkedin.com/in/closed", "status": "failed"}]),
            (11, "tgfail@gmail.com", [{"provider": "telegram", "url": "https://t.me/closed", "status": "failed"}]),
            (12, "mixed@gmail.com", [
                {"provider": "x", "url": "https://x.com/mixed", "status": "failed"},
                {"provider": "instagram", "url": "https://instagram.com/mixed", "status": "not_sent"},
            ]),
            (13, "site@gmail.com", [{"provider": "generic", "url": "https://ada.example", "status": "not_sent"}]),
            (14, "be@gmail.com", [{"provider": "behance", "url": "https://www.behance.net/ada", "status": "sent"}]),
            (15, "dead@gmail.com", [{"provider": "generic", "url": "https://old.example", "status": "failed"}]),
            (16, "both@gmail.com", [
                {"provider": "linkedin", "url": "https://linkedin.com/in/both"},
                {"provider": "kofi", "url": "https://ko-fi.com/both", "status": "not_sent"},
            ]),
            (17, "ghonly@gmail.com", [{"provider": "github", "url": "https://github.com/ada"}]),
        ]
        for uid, email, socials in rows:
            self.conn.execute(
                """
                INSERT INTO users (
                    id, email, name, link, location, country, socials,
                    created_at, updated_at
                )
                VALUES (?, ?, '', '', '', 'usa', ?, ?, ?)
                """,
                (
                    uid,
                    email,
                    None if socials is None else json.dumps(socials),
                    now,
                    now,
                ),
            )
        self.conn.commit()

    def tearDown(self):
        self.conn.close()

    def _ids(self, has_social):
        where, params = social_account_clauses(has_social)
        clause = (" WHERE " + " AND ".join(where)) if where else ""
        rows = self.conn.execute(
            f"SELECT id FROM users{clause} ORDER BY id", params
        ).fetchall()
        return [row["id"] for row in rows]

    def test_linkedin_only(self):
        self.assertEqual(self._ids(["linkedin"]), [1, 3, 10, 16])

    def test_any_of_three_accounts_matches(self):
        self.assertEqual(self._ids(["linkedin", "telegram", "discord"]), [1, 2, 3, 10, 11, 16])

    def test_whatsapp_only(self):
        self.assertEqual(self._ids(["whatsapp"]), [6])

    def test_none_checked_returns_everyone(self):
        self.assertEqual(self._ids([]), list(range(1, 18)))

    def test_upwork_only(self):
        self.assertEqual(self._ids(["upwork"]), [7])

    def test_failed_x_is_hidden_and_sent_x_stays(self):
        self.assertEqual(self._ids(["x"]), [9])

    def test_failed_linkedin_and_telegram_stay_visible(self):
        self.assertEqual(self._ids(["linkedin"]), [1, 3, 10, 16])
        self.assertEqual(self._ids(["telegram"]), [2, 3, 11])

    def test_failed_x_still_matches_an_open_instagram(self):
        self.assertEqual(self._ids(["instagram"]), [12])
        self.assertEqual(self._ids(["x", "instagram"]), [9, 12])

    def test_other_matches_unlisted_open_links(self):
        self.assertEqual(self._ids(["other"]), [13, 14, 16])
        self.assertEqual(self._ids(["other", "linkedin"]), [1, 3, 10, 13, 14, 16])


if __name__ == "__main__":
    unittest.main()
