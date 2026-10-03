import unittest
from datetime import datetime, timezone

from tsundoku.repo import Repo


def fixed_clock() -> datetime:
    return datetime(2026, 1, 1, tzinfo=timezone.utc)


class RepoTest(unittest.TestCase):
    def setUp(self) -> None:
        self.repo = Repo(now=fixed_clock)

    def test_create_assigns_id(self) -> None:
        first = self.repo.create("9784101001012", "吾輩は猫である")
        second = self.repo.create("9784101010014", "坊っちゃん", "reading")
        self.assertEqual((first.id, second.id), (1, 2))
        self.assertEqual(first.status, "unread")
        self.assertEqual(first.added_at, "2026-01-01T00:00:00+00:00")

    def test_remove_is_idempotent(self) -> None:
        book = self.repo.create("9784101001012", "吾輩は猫である")
        self.assertTrue(self.repo.remove(book.id))
        self.assertFalse(self.repo.remove(book.id))
        self.assertIsNone(self.repo.get(book.id))


if __name__ == "__main__":
    unittest.main()
