import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'desktop/workers'))
import torch
from native_h3_weights import converted_tensors, ExactModulationCache


class H3WeightAdaptationTest(unittest.TestCase):
    def test_exact_timestep_cache_reuses_only_identical_inputs(self):
        class Projection(torch.nn.Module):
            def __init__(self):
                super().__init__()
                self.calls = 0
            def forward(self, x):
                self.calls += 1
                return (x * 2, x + 1)
        source = Projection()
        cache = ExactModulationCache(source)
        x = torch.tensor([[1., 2.]])
        first = cache(x)
        second = cache(x.clone())
        self.assertEqual(source.calls, 1)
        for left, right in zip(first, second):
            torch.testing.assert_close(left, right, rtol=0, atol=0)
        cache(x + 0.1)
        self.assertEqual(source.calls, 2)

    def test_vae_head_interleaved_qkv_matches_original_attention(self):
        torch.manual_seed(14)
        weight = torch.randn(32 * 3 * 64, 4)
        bias = torch.randn(32 * 3 * 64)
        sample = torch.randn(2, 5, 4)
        original = torch.nn.functional.linear(sample, weight, bias).reshape(2, 5, 32, 3 * 64).chunk(3, dim=-1)
        weights = dict(converted_tensors('vae', 'decoder.transformer_blocks.0.attn.to_qkv.weight', weight))
        biases = dict(converted_tensors('vae', 'decoder.transformer_blocks.0.attn.to_qkv.bias', bias))
        for expected, projection in zip(original, ('to_q', 'to_k', 'to_v')):
            prefix = f'decoder.transformer_blocks.0.attn.{projection}'
            actual = torch.nn.functional.linear(sample, weights[prefix + '.weight'], biases[prefix + '.bias']).reshape(2, 5, 32, 64)
            torch.testing.assert_close(actual, expected)

    def test_fused_qkv_preserves_three_projections(self):
        weight = torch.arange(72, dtype=torch.float32).reshape(18, 4)
        sample = torch.tensor([[0.2, -0.3, 0.7, 1.0]])
        converted = dict(converted_tensors('transformer', 'blocks.0.attn.qkv_proj.weight', weight))
        actual = torch.cat([torch.nn.functional.linear(sample, converted[f'transformer_blocks.0.attn.{projection}.weight']) for projection in ('to_q', 'to_k', 'to_v')], dim=-1)
        torch.testing.assert_close(actual, torch.nn.functional.linear(sample, weight))

    def test_swiglu_permutation_preserves_original_gate_order(self):
        torch.manual_seed(316)
        weight = torch.randn(12, 4)
        sample = torch.randn(3, 4)
        original_gate, original_value = torch.nn.functional.linear(sample, weight).chunk(2, dim=-1)
        expected = torch.nn.functional.silu(original_gate) * original_value
        for role, source in [('transformer', 'blocks.0.mlp.fc1.weight'), ('vae', 'decoder.transformer_blocks.0.ff.w1.weight')]:
            adapted = next(converted_tensors(role, source, weight))[1]
            value, gate = torch.nn.functional.linear(sample, adapted).chunk(2, dim=-1)
            torch.testing.assert_close(value * torch.nn.functional.silu(gate), expected)


if __name__ == '__main__':
    unittest.main()
