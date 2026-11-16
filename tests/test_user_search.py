import unittest

from server.dashboard import user_search_text


class UserSearchTextTests(unittest.TestCase):
    def test_leading_at_is_dropped(self):
        self.assertEqual(user_search_text("  @example_user  "), "example_user")
        self.assertEqual(user_search_text("@@example_user"), "example_user")

    def test_email_keeps_its_at_sign(self):
        self.assertEqual(user_search_text("ada@example.com"), "ada@example.com")

    def test_blank_stays_blank(self):
        self.assertEqual(user_search_text("   "), "")
        self.assertEqual(user_search_text("@"), "")
        self.assertEqual(user_search_text(None), "")


if __name__ == "__main__":
    unittest.main()
