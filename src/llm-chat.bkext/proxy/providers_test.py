import unittest

from providers import OpenAIProvider, merge_same_role_runs


class MergeSameRoleRunsTests(unittest.TestCase):
    def test_merges_consecutive_roles(self) -> None:
        conversation = [
            {"role": "user", "content": "Hello"},
            {"role": "user", "content": "World"},
            {"role": "assistant", "content": "Hi"},
            {"role": "assistant", "content": "Again"},
        ]

        merged = merge_same_role_runs(conversation)

        self.assertEqual(
            merged,
            [
                {"role": "user", "content": "Hello\nWorld"},
                {"role": "assistant", "content": "Hi\nAgain"},
            ],
        )

    def test_skips_empty_content(self) -> None:
        conversation = [
            {"role": "user", "content": "Hello"},
            {"role": "user", "content": ""},
            {"role": "assistant", "content": "Hi"},
            {"role": "assistant", "content": "   "},
        ]

        merged = merge_same_role_runs(conversation)

        self.assertEqual(
            merged,
            [
                {"role": "user", "content": "Hello"},
                {"role": "assistant", "content": "Hi"},
            ],
        )


class OpenAIProviderTests(unittest.TestCase):
    def test_prepare_messages_uses_last_system_prompt(self) -> None:
        provider = OpenAIProvider()
        messages = [
            {"role": "system", "content": "First system"},
            {"role": "user", "content": "Hello"},
            {"role": "system", "content": "Second system"},
            {"role": "assistant", "content": "Hi"},
        ]

        prepared = provider.prepare_messages(messages)

        self.assertEqual(prepared["instructions"], "Second system")
        self.assertEqual(
            prepared["conversation"],
            [
                {"role": "user", "content": "Hello"},
                {"role": "assistant", "content": "Hi"},
            ],
        )

    def test_prepare_messages_merges_consecutive_roles(self) -> None:
        provider = OpenAIProvider()
        messages = [
            {"role": "user", "content": "Hello"},
            {"role": "user", "content": "Again"},
            {"role": "assistant", "content": "Hi"},
            {"role": "assistant", "content": "More"},
        ]

        prepared = provider.prepare_messages(messages)

        self.assertEqual(
            prepared["conversation"],
            [
                {"role": "user", "content": "Hello\nAgain"},
                {"role": "assistant", "content": "Hi\nMore"},
            ],
        )


if __name__ == "__main__":
    unittest.main()
