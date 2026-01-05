import unittest

from providers import AnthropicProvider, OpenAIProvider, OpenRouterProvider, merge_same_role_runs


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


class AnthropicProviderCachingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.provider = AnthropicProvider()

    def test_promotes_earlier_user_breakpoints_to_one_hour(self) -> None:
        conversation = [
            {"role": "user", "content": "u1"},
            {"role": "user", "content": "u2"},
            {"role": "user", "content": "u3", "cacheControl": {"type": "ephemeral", "ttl": "1h"}},
            {"role": "user", "content": "u4"},
            {"role": "user", "content": "u5"},
        ]

        cached = self.provider._apply_prompt_caching(conversation)

        def ttl_for(index: int) -> str:
            content = cached[index]["content"]
            if isinstance(content, list):
                return content[0]["cache_control"].get("ttl") or "5m"
            return "none"

        self.assertEqual(ttl_for(1), "1h")
        self.assertEqual(ttl_for(2), "1h")
        self.assertEqual(ttl_for(3), "5m")
        self.assertEqual(ttl_for(4), "5m")

    def test_limits_breakpoints_to_four(self) -> None:
        conversation = [
            {"role": "user", "content": "u1"},
            {"role": "user", "content": "u2"},
            {"role": "assistant", "content": "a1", "cacheControl": {"type": "ephemeral", "ttl": "1h"}},
            {"role": "user", "content": "u3"},
            {"role": "user", "content": "u4"},
            {"role": "user", "content": "u5"},
        ]

        cached = self.provider._apply_prompt_caching(conversation)

        breakpoints = 0
        for message in cached:
            content = message["content"]
            if isinstance(content, list):
                breakpoints += 1

        self.assertEqual(breakpoints, 4)

    def test_cache_marker_on_first_message(self) -> None:
        conversation = [
            {"role": "user", "content": "u1", "cacheControl": {"type": "ephemeral", "ttl": "1h"}},
            {"role": "user", "content": "u2"},
            {"role": "user", "content": "u3"},
            {"role": "user", "content": "u4"},
            {"role": "user", "content": "u5"},
        ]

        cached = self.provider._apply_prompt_caching(conversation)

        self.assertIsInstance(cached[0]["content"], list)
        self.assertIsInstance(cached[1]["content"], str)
        self.assertIsInstance(cached[2]["content"], list)
        self.assertIsInstance(cached[3]["content"], list)
        self.assertIsInstance(cached[4]["content"], list)

    def test_default_recent_user_breakpoints(self) -> None:
        conversation = [
            {"role": "user", "content": "u1"},
            {"role": "user", "content": "u2"},
            {"role": "user", "content": "u3"},
            {"role": "user", "content": "u4"},
            {"role": "user", "content": "u5"},
        ]

        cached = self.provider._apply_prompt_caching(conversation)

        self.assertIsInstance(cached[0]["content"], str)
        self.assertIsInstance(cached[1]["content"], list)
        self.assertIsInstance(cached[2]["content"], list)
        self.assertIsInstance(cached[3]["content"], list)
        self.assertIsInstance(cached[4]["content"], list)

    def test_only_latest_one_hour_marker_applies(self) -> None:
        conversation = [
            {"role": "user", "content": "u1"},
            {"role": "user", "content": "u2", "cacheControl": {"type": "ephemeral", "ttl": "1h"}},
            {"role": "user", "content": "u3"},
            {"role": "user", "content": "u4"},
            {"role": "user", "content": "u5"},
            {"role": "user", "content": "u6", "cacheControl": {"type": "ephemeral", "ttl": "1h"}},
        ]

        cached = self.provider._apply_prompt_caching(conversation)

        self.assertIsInstance(cached[1]["content"], str)
        self.assertIsInstance(cached[2]["content"], list)
        self.assertIsInstance(cached[3]["content"], list)


class OpenRouterProviderTests(unittest.TestCase):
    def test_prepare_messages_uses_last_system_prompt(self) -> None:
        provider = OpenRouterProvider()
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
        provider = OpenRouterProvider()
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
