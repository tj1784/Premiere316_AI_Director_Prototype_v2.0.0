"""CPU-only contracts for the actual Krea worker; never starts an image model."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("p316_krea_worker", ROOT / "desktop/workers/krea2_jsonl_worker.py")
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)
sys.path.insert(0, r"D:\Projects\krea-2")


class KreaWorkerContract(unittest.TestCase):
    def test_actual_mmdit_forward_runs_with_compilation_disabled(self):
        import torch
        from mmdit import RMSNorm, PositionalEncoding, LastLayer
        w._configure_eager_mmdit()
        w._configure_eager_mmdit()  # Repeated loads remain safe.
        x = torch.randn(1, 3, 4)
        norm = RMSNorm(4)
        torch.testing.assert_close(norm(x), torch.nn.functional.rms_norm(x, (4,), weight=torch.ones(4), eps=1e-5))
        self.assertTrue(torch.isfinite(PositionalEncoding(6, [2, 2, 2])(torch.zeros(1, 3, 3))).all())
        self.assertEqual(LastLayer(4, 2, 2)(x, torch.randn(1, 1, 4)).shape, (1, 3, 8))
        for cls in (RMSNorm, PositionalEncoding, LastLayer):
            self.assertFalse(hasattr(cls.forward, "_torchdynamo_orig_callable"))

    def test_installed_checkpoint_headers_match_official_architectures_strictly(self):
        import torch
        from safetensors import safe_open
        from safetensors.torch import load_file
        from transformers import AutoConfig, Qwen3VLModel
        from diffusers import AutoencoderKLQwenImage
        from diffusers.loaders.single_file_utils import convert_wan_vae_to_diffusers
        from mmdit import SingleStreamDiT
        folder = Path(r"D:\Projects\krea-2\local-components")
        if not folder.exists():
            self.skipTest("Installed Krea component configuration is absent")
        with torch.device("meta"):
            flow = SingleStreamDiT(w._flow_config())
            encoder = Qwen3VLModel(AutoConfig.from_pretrained(str(folder / "qwen3-vl-4b"), local_files_only=True))
            vae = AutoencoderKLQwenImage.from_config(json.loads((folder / "qwen-image-vae/config.json").read_text()))
        for model, path, prefix in [(flow, r"D:\AI\Models\diffusion_models\Krea 2\krea2_raw_bf16.safetensors", ""),
                                     (encoder, r"D:\AI\Models\text_encoders\Qwen3-VL-4B\qwen3vl_4b_bf16.safetensors", "model.")]:
            with safe_open(path, framework="pt", device="cpu") as checkpoint:
                shapes = {key.removeprefix(prefix): checkpoint.get_slice(key).get_shape() for key in checkpoint.keys()}
            w._strict_shapes(model, shapes, "Installed checkpoint")
        self.assertTrue(any(value.device.type == "meta" for _, value in encoder.named_buffers()))
        w._materialize_encoder_rotary(encoder)
        self.assertTrue(all(value.device.type == "cpu" for _, value in encoder.named_buffers()))
        state = convert_wan_vae_to_diffusers(load_file(r"D:\AI\Models\vae\Krea 2\krea2RealVae_v10.safetensors", device="cpu"))
        w._strict_shapes(vae, {key: value.shape for key, value in state.items()}, "Installed VAE")
        self.assertEqual(len(state), 194)

    def test_context_cache_exact_roundtrip_and_corruption_rejected(self):
        import torch
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {"P316_CACHE_ROOT": folder}):
            ctx = torch.randn(1, 16, 12, 2560, dtype=torch.bfloat16)
            mask = torch.ones(1, 16, dtype=torch.bool)
            info = w._store_context("exact prompt", ctx, mask, 123)
            got, got_mask, got_info = w._load_context("exact prompt")
            self.assertTrue(torch.equal(ctx, got))
            self.assertTrue(torch.equal(mask, got_mask))
            self.assertEqual(info, got_info)
            self.assertNotEqual(w._cache_key("exact prompt"), w._cache_key("changed prompt"))
            with self.assertRaisesRegex(ValueError, "missing"):
                w._load_context("changed prompt")
            _, path, _ = w._cache_paths("exact prompt")
            with path.open("r+b") as handle:
                handle.seek(-1, 2)
                handle.write(b"\xff")
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                w._load_context("exact prompt")

    def test_encode_keeps_long_prompt_and_exact_official_layer_selection(self):
        import torch
        from transformers import AutoTokenizer
        tokenizer = AutoTokenizer.from_pretrained(r"D:\Projects\krea-2\local-components\qwen3-vl-4b", local_files_only=True)
        class Encoder:
            def __call__(self, input_ids, attention_mask, **kwargs):
                self.ids, self.mask, self.kwargs = input_ids, attention_mask, kwargs
                return types.SimpleNamespace(hidden_states=[torch.full((1, input_ids.shape[1], 8), value, dtype=torch.bfloat16) for value in range(37)])
        encoder = Encoder()
        original_to = torch.Tensor.to
        def cpu_to(tensor, *args, **kwargs):
            if args and args[0] == "cuda": args = ("cpu", *args[1:])
            if kwargs.get("device") == "cuda": kwargs["device"] = "cpu"
            return original_to(tensor, *args, **kwargs)
        prompt = "ancient woven maroon cloth with black stripes " * 160
        with patch.object(torch.Tensor, "to", cpu_to):
            ctx, mask = w._encode_one(encoder, tokenizer, prompt)
        self.assertGreater(ctx.shape[1], 1024)
        self.assertEqual(ctx.shape[1], len(tokenizer(w.PREFIX + prompt)["input_ids"]) + w.SUFFIX_TOKENS - w.PREFIX_TOKENS)
        self.assertEqual(ctx[0, 0, :, 0].tolist(), list(w.LAYERS))
        self.assertFalse(encoder.kwargs["use_cache"])
        self.assertTrue(bool(mask.all()))
        with self.assertRaisesRegex(ValueError, "no text was truncated"):
            w._encode_one(encoder, tokenizer, prompt * 4)

    def test_all_prompts_encode_before_encoder_unload_and_no_base_load(self):
        import torch
        events = []
        class Encoder: pass
        def load_encoder():
            events.append("load encoder")
            return Encoder(), object()
        def encode(_encoder, _tokenizer, prompt):
            events.append("encode:" + prompt)
            return None, None
        def store(prompt, _ctx, _mask, ms):
            return {"encodeMs": ms, "prompt": prompt}
        with patch.object(w, "_identity", return_value={}), patch.object(w, "_source"), patch.object(w, "_release"), \
             patch.object(w, "_load_context", side_effect=ValueError("missing")), patch.object(w, "_load_encoder", side_effect=load_encoder), \
             patch.object(w, "_encode_one", new=encode), patch.object(w, "_store_context", side_effect=store), \
             patch.object(w, "_cuda_release", side_effect=lambda: events.append("unload encoder")), \
             patch.object(torch.cuda, "mem_get_info", return_value=(70 * 1024**3, 72 * 1024**3)), patch.object(w, "_load_base") as base:
            result = w._encode_prompts(["first", "second", "first"])
        self.assertEqual(events, ["load encoder", "encode:first", "encode:second", "encode:", "unload encoder"])
        self.assertEqual(result["promptCount"], 3)
        self.assertTrue(result["encoderReleased"])
        base.assert_not_called()

    def test_prepared_batch_never_falls_back_when_prompt_cache_is_missing(self):
        with patch.object(w, "BATCH_PREPARED", True), patch.object(w, "_identity", return_value={}), patch.object(w, "_source"), \
             patch.object(w, "_load_context", side_effect=ValueError("missing")), patch.object(w, "_encode_prompts") as encode, patch.object(w, "_load_base") as base:
            with self.assertRaisesRegex(ValueError, "missing"):
                w._generate({"prompt": "changed"})
        encode.assert_not_called()
        base.assert_not_called()

    def test_generation_rejects_pixel_references_and_invalid_dimensions(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {"P316_OUTPUT_ROOT": folder}):
            request = {"method": "generate", "prompt": "portrait", "out": str(Path(folder) / "image.png"), "width": 1024, "height": 1024, "seed": 1}
            self.assertEqual(w._validate_generate(request)["width"], 1024)
            self.assertEqual(w._validate_generate({**request, "width": 1536})["width"], 1536)
            with self.assertRaisesRegex(ValueError, "text-to-image only"):
                w._validate_generate({**request, "references": ["reference.png"]})
            with self.assertRaisesRegex(ValueError, "accepts"):
                w._validate_generate({**request, "width": 2048})
            with self.assertRaisesRegex(ValueError, "escapes"):
                w._validate_generate({**request, "out": str(Path(folder).parent / "outside.png")})


if __name__ == "__main__":
    unittest.main()
