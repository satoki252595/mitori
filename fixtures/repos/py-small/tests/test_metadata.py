import io
import json
import unittest

from tsundoku.metadata import MAX_RETRIES, fetch_metadata

KOKORO = {"ISBN:9784101010137": {"title": "こころ", "authors": [{"name": "夏目漱石"}], "number_of_pages": 248}}


class _Response(io.StringIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class ScriptedOpener:
    """Raises for the first `failures` calls, then answers with KOKORO."""

    def __init__(self, failures: int) -> None:
        self.failures = failures
        self.calls = 0

    def __call__(self, url, timeout=None):
        self.calls += 1
        if self.calls <= self.failures:
            raise OSError("connection reset")
        return _Response(json.dumps(KOKORO))


class MetadataTest(unittest.TestCase):
    def test_fetch_metadata_retries_once(self) -> None:
        opener = ScriptedOpener(failures=MAX_RETRIES)
        meta = fetch_metadata("978-4-10-101013-7", opener)
        self.assertEqual(meta.title, "こころ")
        self.assertEqual(opener.calls, 2)

        dead = ScriptedOpener(failures=99)
        with self.assertRaises(OSError):
            fetch_metadata("9784101010137", dead)
        self.assertEqual(dead.calls, MAX_RETRIES + 1)

    def test_fetch_metadata_no_retry_on_success(self) -> None:
        opener = ScriptedOpener(failures=0)
        fetch_metadata("9784101010137", opener)
        self.assertEqual(opener.calls, 1)


if __name__ == "__main__":
    unittest.main()
