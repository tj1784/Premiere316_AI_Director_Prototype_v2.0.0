"""Check the worker's prompt conditioning contract without loading model weights."""
import ast
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace
import unittest


class ConditioningTest(unittest.TestCase):
    def test_t5_uses_full_padded_sequence_like_official_bfl_embedder(self):
        source = Path(__file__).resolve().parents[1] / "desktop/workers/flux1_jsonl_worker.py"
        parsed = ast.parse(source.read_text(encoding="utf-8"))
        function = next(node for node in parsed.body if isinstance(node, ast.FunctionDef) and node.name == "_encode_prompt")
        calls = []

        class Batch(dict):
            def to(self, _device):
                return self

        def t5(**kwargs):
            calls.append(kwargs)
            return SimpleNamespace(last_hidden_state="text embedding")

        namespace = {"Any": object, "MODELS": {
            "torch": SimpleNamespace(no_grad=nullcontext), "device": "cpu",
            "t5_tokenizer": lambda *args, **kwargs: Batch(input_ids="padded tokens", attention_mask="padding mask"),
            "t5": t5, "clip_tokenizer": lambda *args: Batch(),
            "clip": lambda **kwargs: SimpleNamespace(pooler_output="pooled embedding"),
        }}
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(source), "exec"), namespace)
        self.assertEqual(namespace["_encode_prompt"]("Moses in linen robes"), {"txt": "text embedding", "vec": "pooled embedding"})
        self.assertEqual(calls, [{"input_ids": "padded tokens", "attention_mask": None, "output_hidden_states": False}])


if __name__ == "__main__":
    unittest.main()
