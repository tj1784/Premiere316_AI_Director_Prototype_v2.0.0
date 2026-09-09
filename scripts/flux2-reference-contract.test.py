import hashlib
import builtins
import io
import os
from pathlib import Path
import runpy
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, r"D:\Projects\Flux2\src")
with patch.object(sys, "stdin", io.StringIO("")):
    worker = runpy.run_path(str(ROOT / "desktop/workers/flux2_jsonl_worker.py"))

class Flux2ReferenceContract(unittest.TestCase):
    def test_authorized_dimensions_reach_latent_grid_and_saved_png_without_gpu(self):
        import torch
        from PIL import Image
        import flux2.sampling as sampling
        seen = []
        class Decoder:
            def decode(self, latent):
                self_shape = tuple(latent.shape)
                seen.append(self_shape)
                return torch.zeros(1, 3, latent.shape[2] * 16, latent.shape[3] * 16)
        models = {"torch": torch, "device": "cpu", "dtype": torch.bfloat16,
                  "text_encoder": lambda prompts: torch.zeros(1, 4, 15360), "flow": object(), "ae": Decoder()}
        session = {"identity": {}, "componentDigest": "test", "loadMs": 0}
        def denoise(model, image, image_ids, ctx, ctx_ids, **kwargs):
            self.assertEqual(image.shape[1], image_ids.shape[1])
            self.assertEqual(kwargs["guidance"], 4.0)
            self.assertEqual(len(kwargs["timesteps"]), 51)
            return image
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {"P316_OUTPUT_ROOT": folder}), \
             patch.dict(worker["_generate"].__globals__, {"MODELS": models, "_load_session": lambda: session, "_cuda_memory": lambda: None}), \
             patch.object(sampling, "denoise", new=denoise):
            for size in [512, 1024]:
                request = worker["_validate_request"]({"method": "generate", "prompt": "dimension fixture", "width": size, "height": size,
                                                       "seed": 316, "references": [], "out": str(Path(folder) / f"{size}.png")})
                self.assertEqual((request["width"], request["height"]), (size, size))
                result = worker["_generate"](request)
                self.assertTrue(result["ok"])
                with Image.open(request["out"]) as image:
                    self.assertEqual(image.size, (size, size))
        self.assertEqual(seen, [(1, 128, 32, 32), (1, 128, 64, 64)])

    def test_dimension_validator_rejects_unsupported_shapes_and_output_escape(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {"P316_OUTPUT_ROOT": folder}):
            request = {"method": "generate", "prompt": "fixture", "width": 1024, "height": 1024, "seed": 316,
                       "out": str(Path(folder) / "image.png"), "references": []}
            for width, height in [(1024, 512), (513, 513), (2048, 2048)]:
                with self.assertRaisesRegex(ValueError, "accepts"):
                    worker["_validate_request"]({**request, "width": width, "height": height})
            with self.assertRaisesRegex(ValueError, "escapes"):
                worker["_validate_request"]({**request, "out": str(Path(folder).parent / "outside.png")})

    def test_pinned_vae_maps_every_tensor_strictly_without_changing_values(self):
        import torch
        from safetensors.torch import load_file
        from flux2.autoencoder import AutoEncoder, AutoEncoderParams
        checkpoint = Path(r"D:\AI\Models\vae\flux2\flux2-vae.safetensors")
        if not checkpoint.exists():
            checkpoint = Path(r"D:\AI\Models\vae\flux2-vae.safetensors")
        if not checkpoint.exists():
            self.skipTest("Pinned VAE is not installed")
        original = load_file(str(checkpoint), device="cpu")
        converted = worker["_native_vae_state"](original)
        with torch.device("meta"):
            model = AutoEncoder(AutoEncoderParams())
        worker["_validate_tensor_shapes"](model.state_dict(), {key: value.shape for key, value in converted.items()}, "VAE")
        result = model.load_state_dict(converted, strict=True, assign=True)
        self.assertEqual(result.missing_keys, [])
        self.assertEqual(result.unexpected_keys, [])
        self.assertEqual(len(original), len(converted))
        self.assertIs(converted["decoder.up.3.block.0.conv1.weight"], original["decoder.up_blocks.0.resnets.0.conv1.weight"])
        self.assertIs(converted["decoder.up.0.block.0.conv1.weight"], original["decoder.up_blocks.3.resnets.0.conv1.weight"])
        self.assertIs(converted["encoder.quant_conv.weight"], original["quant_conv.weight"])
        self.assertIs(converted["decoder.post_quant_conv.weight"], original["post_quant_conv.weight"])
        weight = original["encoder.mid_block.attentions.0.to_q.weight"]
        mapped = converted["encoder.mid.attn_1.q.weight"]
        self.assertTrue(torch.equal(mapped[:, :, 0, 0], weight))
        x = torch.randn(1, weight.shape[1], 2, 3)
        linear = torch.nn.functional.linear(x.permute(0, 2, 3, 1), weight).permute(0, 3, 1, 2)
        conv = torch.nn.functional.conv2d(x, mapped)
        torch.testing.assert_close(linear, conv, rtol=1e-5, atol=1e-5)

    def test_preflight_rejects_missing_unexpected_and_mismatched_shapes_concisely(self):
        import torch
        with self.assertRaisesRegex(RuntimeError, r"1 missing.*1 unexpected.*1 shape mismatches") as error:
            worker["_validate_tensor_shapes"]({"missing": torch.empty(1), "wrong": torch.empty(2)}, {"extra": (1,), "wrong": (3,)}, "VAE")
        self.assertLess(len(str(error.exception)), 300)

    def test_pinned_vae_cpu_encode_decode_matches_diffusers_including_batch_normalization(self):
        import torch
        from safetensors.torch import load_file
        from flux2.autoencoder import AutoEncoder, AutoEncoderParams
        from diffusers.models.autoencoders.autoencoder_kl_flux2 import AutoencoderKLFlux2
        checkpoint = Path(r"D:\AI\Models\vae\flux2\flux2-vae.safetensors")
        if not checkpoint.exists():
            checkpoint = Path(r"D:\AI\Models\vae\flux2-vae.safetensors")
        if not checkpoint.exists():
            self.skipTest("Pinned VAE is not installed")
        state = load_file(str(checkpoint), device="cpu")
        with torch.device("meta"):
            native = AutoEncoder(AutoEncoderParams()).eval()
            reference = AutoencoderKLFlux2().eval()
        native.load_state_dict(worker["_native_vae_state"](state), strict=True, assign=True)
        reference.load_state_dict(state, strict=True, assign=True)
        threads = torch.get_num_threads()
        torch.set_num_threads(4)
        try:
            with torch.no_grad():
                image = torch.randn(1, 3, 64, 64, generator=torch.Generator().manual_seed(316))
                encoded = native.encode(image)
                mean = reference.encode(image).latent_dist.mode()
                packed = mean.reshape(1, 32, 4, 2, 4, 2).permute(0, 1, 3, 5, 2, 4).reshape(1, 128, 4, 4)
                bn_mean = reference.bn.running_mean.reshape(1, -1, 1, 1)
                bn_std = torch.sqrt(reference.bn.running_var.reshape(1, -1, 1, 1) + reference.config.batch_norm_eps)
                expected_encoded = (packed - bn_mean) / bn_std
                torch.testing.assert_close(encoded, expected_encoded, rtol=2e-4, atol=2e-4)
                latent = torch.randn(encoded.shape, generator=torch.Generator().manual_seed(317))
                decoded = native.decode(latent)
                unnormalized = latent * bn_std + bn_mean
                unpacked = unnormalized.reshape(1, 32, 2, 2, 4, 4).permute(0, 1, 4, 2, 5, 3).reshape(1, 32, 8, 8)
                expected_decoded = reference.decode(unpacked).sample
                torch.testing.assert_close(decoded, expected_decoded, rtol=2e-4, atol=2e-4)
                print(f"VAE CPU parity: encode max error={(encoded - expected_encoded).abs().max().item():.8f}; decode max error={(decoded - expected_decoded).abs().max().item():.8f}")
        finally:
            torch.set_num_threads(threads)

    def test_generation_initializes_pinned_source_before_importing_sampling(self):
        initialized = False
        original_import = builtins.__import__

        def initialize():
            nonlocal initialized
            initialized = True
            return {}

        def guarded_import(name, *args, **kwargs):
            if name == "flux2.sampling":
                self.assertTrue(initialized, "The pinned source must be initialized before importing flux2.sampling")
                raise RuntimeError("Stop before GPU generation")
            return original_import(name, *args, **kwargs)

        with patch.dict(worker["_generate"].__globals__, {"_load_session": initialize}), patch.object(builtins, "__import__", side_effect=guarded_import):
            with self.assertRaisesRegex(RuntimeError, "Stop before GPU generation"):
                worker["_generate"]({})

    def test_attached_reference_bytes_are_verified_and_escape_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            data = b"reference fixture"
            reference = root / ("reference-" + hashlib.sha256(data).hexdigest() + ".png")
            reference.write_bytes(data)
            request = {"method": "generate", "prompt": "p", "width": 512, "height": 512, "seed": 1, "out": str(root / "result.png"), "references": [str(reference)]}
            with patch.dict(os.environ, {"P316_OUTPUT_ROOT": folder}):
                self.assertEqual(worker["_validate_request"](request)["references"], [reference.resolve()])
                reference.write_bytes(b"changed")
                with self.assertRaisesRegex(ValueError, "hash mismatch"):
                    worker["_validate_request"](request)
                request["references"] = [str(ROOT / "package.json")]
                with self.assertRaisesRegex(ValueError, "escapes"):
                    worker["_validate_request"](request)

    def test_long_context_is_encoded_on_cpu_without_truncating_to_512(self):
        import torch
        import transformers
        class Model(torch.nn.Module):
            def __init__(self):
                super().__init__()
                self.weight = torch.nn.Parameter(torch.zeros(1))
            @property
            def device(self): return self.weight.device
            def forward(self, input_ids, **kwargs):
                return types.SimpleNamespace(hidden_states=[torch.zeros(1, input_ids.shape[-1], 1)] * 31)
        class Processor:
            length = 1400
            def apply_chat_template(self, *args, **kwargs):
                self.kwargs = kwargs
                return {"input_ids": torch.zeros(1, self.length, dtype=torch.int64), "attention_mask": torch.ones(1, self.length, dtype=torch.int64)}
        model = Model(); processor = Processor()
        with patch.dict(os.environ, {"P316_MISTRAL_MODEL": "unused", "P316_MISTRAL_PROCESSOR": "unused"}), patch.object(transformers.Mistral3ForConditionalGeneration, "from_pretrained", return_value=model), patch.object(transformers.AutoProcessor, "from_pretrained", return_value=processor):
            encoder = worker["_load_offline_mistral"]("cuda")
            output = encoder(["long prompt"])
            self.assertEqual(output.shape, (1, 1400, 3))
            self.assertEqual(model.device.type, "cpu")
            self.assertFalse(processor.kwargs["truncation"])
            processor.length = 5000
            with self.assertRaisesRegex(ValueError, "no text was truncated"):
                encoder(["too long"])

if __name__ == "__main__": unittest.main()
