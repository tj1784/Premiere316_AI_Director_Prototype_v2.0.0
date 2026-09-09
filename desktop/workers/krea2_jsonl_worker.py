"""App-owned, offline Krea 2 RAW worker with staged GPU text encoding.

The official RAW checkpoint is text-to-image only. Reference pictures are never
silently treated as pixel conditioning. The host may retain prompt-source links.
"""
from __future__ import annotations

import gc
import hashlib
import json
import os
import sys
import time
import traceback
from pathlib import Path
from typing import Any
from uuid import uuid4

PROTOCOL_VERSION = "premiere316.krea2-jsonl.v1"
SOURCE_HEAD = "db3984fbc6e13b34c0064990fc2d95ac64d00058"
CACHE_VERSION = "krea2-qwen3vl-context-v1"
STEPS, GUIDANCE = 52, 3.5
MAX_PROMPT_CHARS, MAX_CONTEXT_TOKENS = 20000, 4096
LAYERS = (2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35)
PREFIX = "<|im_start|>system\nDescribe the image by detailing the color, shape, size, texture, quantity, text, spatial relationships of the objects and background:<|im_end|>\n<|im_start|>user\n"
SUFFIX = "<|im_end|>\n<|im_start|>assistant\n"
PREFIX_TOKENS, SUFFIX_TOKENS = 34, 5
COMPONENTS = {
    "transformer": ("P316_MODEL_KREA2", "f99bb0ff8e362b77342bc4994e0c50906fe7ef7074864b181b7d48d2fa6d03d7", 26283332608),
    "text_encoder": ("P316_MODEL_KREA2_QWEN", "36f3ff447ef59201722e8f9ce6020c9819fdcfba6aa2608c4e09b1c0ce114e34", 8875719384),
    "vae": ("P316_MODEL_KREA2_VAE", "0dbbe0baeca04c2b98d2f3809c6f595608939809c88b695ba971368f17c874b8", 507591212),
}
SMALL_FILES = {
    ("P316_KREA_SOURCE_ROOT", "mmdit.py"): "6fabe02508a495027710456a1a480690cfab6d998dcd0307686eada81b00a6b9",
    ("P316_KREA_SOURCE_ROOT", "sampling.py"): "57c86a7cf4bc8e31e0a5d22c740136461523cfeda0686237b301077c3adfac3b",
    ("P316_KREA_QWEN_CONFIG", "config.json"): "edac7703329133edfc53e46ac0081835144c99d7eebf28b71c732694d435224d",
    ("P316_KREA_QWEN_CONFIG", "tokenizer.json"): "a5d85b6dcc535e6b93115a9ef287e6132fdbf30270da6218194ba742261173c7",
    ("P316_KREA_QWEN_CONFIG", "tokenizer_config.json"): "c2da771801886ad9ae98181793ffd3dfb7f1af30f6f7c6a4e15d7dbba52e2399",
    ("P316_KREA_VAE_CONFIG", "config.json"): "e4e61b7553f930e9eabf8935f0a77e6d004cc3ee67a601a56ef03cc41ccada68",
}
for key in ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "HF_TOKEN", "HUGGING_FACE_HUB_TOKEN", "OPENAI_API_KEY", "XAI_API_KEY", "ANTHROPIC_API_KEY", "BFL_API_KEY"]:
    os.environ.pop(key, None)
os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_DATASETS_OFFLINE="1", TORCH_COMPILE_DISABLE="1", PYTHONDONTWRITEBYTECODE="1")

MODELS: dict[str, Any] = {}
IDENTITY: dict[str, Any] | None = None
BATCH_PREPARED = False
ENCODING_STAGE = "idle"


def _emit(value):
    print(json.dumps(value, separators=(",", ":")), flush=True)


def _log(message):
    print(f"[KREA.2 {time.strftime('%Y-%m-%d %H:%M:%S')}] {message}", file=sys.stderr, flush=True)


def _env(name):
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing worker environment {name}")
    return Path(value)


def _hash(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(4 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _identity(verify=False):
    global IDENTITY
    if verify and IDENTITY is not None:
        return IDENTITY
    parts = {}
    for role, (env, expected, size) in COMPONENTS.items():
        path = _env(env)
        present = path.is_file() and path.stat().st_size == size
        item = {"pathName": path.name, "expectedSha256": expected, "expectedSizeBytes": size, "present": present}
        if verify:
            if not present or _hash(path) != expected:
                raise RuntimeError(f"Pinned KREA.2 {role} component identity mismatch")
            item.update(sha256=expected, hashOk=True)
        parts[role] = item
    if verify:
        for (env, name), expected in SMALL_FILES.items():
            if _hash(_env(env) / name) != expected:
                raise RuntimeError(f"Pinned KREA.2 source/config identity mismatch: {name}")
    result = {"workerProtocolVersion": PROTOCOL_VERSION, "workerSha256": _hash(Path(os.environ.get("P316_WORKER_FILE", __file__))),
              "runtime": "krea-ai/krea-2", "sourceHead": SOURCE_HEAD, "model": "krea2-raw", "supportsReferences": False,
              "supportedDimensions": [[512, 512], [1024, 1024], [1536, 1024]], "defaultWidth": 1024, "defaultHeight": 1024,
              "executionMode": "eager",
              "steps": STEPS, "guidance": GUIDANCE, "scheduleId": "krea2-raw-resolution-aware-euler",
              "encodingModes": ["gpu-batch-cache"], "textEncoderDevice": "cuda", "maxContextTokens": MAX_CONTEXT_TOKENS,
              "truncatesPrompt": False, "components": parts}
    if verify:
        IDENTITY = result
    return result


def _source():
    root = str(_env("P316_KREA_SOURCE_ROOT").resolve())
    if root not in sys.path:
        sys.path.insert(0, root)


def _prompt(value, allow_empty=False):
    if not isinstance(value, str):
        raise ValueError("Prompt must be text")
    value = value.strip()
    if (not value and not allow_empty) or len(value) > MAX_PROMPT_CHARS:
        raise ValueError("Prompt must contain 1-20000 characters")
    return value


def _cache_key(prompt):
    return _digest({"version": CACHE_VERSION, "prompt": prompt, "encoderSha256": COMPONENTS["text_encoder"][1],
                    "tokenizer": [(name, expected) for (env, name), expected in SMALL_FILES.items() if env == "P316_KREA_QWEN_CONFIG"],
                    "prefix": PREFIX, "suffix": SUFFIX, "prefixTokens": PREFIX_TOKENS, "suffixTokens": SUFFIX_TOKENS,
                    "layers": LAYERS, "dtype": "bfloat16", "device": "cuda", "minimumContext": 512, "maxContext": MAX_CONTEXT_TOKENS})


def _cache_paths(prompt):
    root = _env("P316_CACHE_ROOT").resolve() / "krea2-prompt-contexts"
    root.mkdir(parents=True, exist_ok=True)
    key = _cache_key(prompt)
    return key, root / f"{key}.safetensors", root / f"{key}.json"


def _check_context(ctx, mask):
    import torch
    if ctx.dtype != torch.bfloat16 or ctx.ndim != 4 or ctx.shape[0] != 1 or tuple(ctx.shape[2:]) != (12, 2560) or not 1 <= ctx.shape[1] <= MAX_CONTEXT_TOKENS:
        raise ValueError("Cached KREA.2 context has an invalid shape or dtype")
    if mask.dtype != torch.bool or tuple(mask.shape) != tuple(ctx.shape[:2]) or not bool(mask.any()) or not bool(torch.isfinite(ctx).all()):
        raise ValueError("Cached KREA.2 context mask or values are invalid")


def _store_context(prompt, ctx, mask, encode_ms):
    import torch
    from safetensors.torch import save_file
    ctx = ctx.detach().to(device="cpu", dtype=torch.bfloat16).contiguous()
    mask = mask.detach().to(device="cpu", dtype=torch.bool).contiguous()
    _check_context(ctx, mask)
    key, path, metadata = _cache_paths(prompt)
    tmp = path.with_name(f"{key}.{uuid4().hex}.tmp")
    tmp_meta = metadata.with_name(f"{key}.{uuid4().hex}.tmp.json")
    try:
        save_file({"ctx": ctx, "mask": mask}, str(tmp))
        info = {"cacheVersion": CACHE_VERSION, "cacheKey": key, "cacheSha256": _hash(tmp), "contextLength": ctx.shape[1],
                "promptHash": hashlib.sha256(prompt.encode()).hexdigest(), "device": "cuda", "encodeMs": encode_ms,
                "encoderSha256": COMPONENTS["text_encoder"][1]}
        tmp_meta.write_text(json.dumps(info, sort_keys=True), encoding="utf-8")
        os.replace(tmp, path)
        os.replace(tmp_meta, metadata)
        return info
    finally:
        tmp.unlink(missing_ok=True)
        tmp_meta.unlink(missing_ok=True)


def _load_context(prompt):
    from safetensors.torch import load_file
    key, path, metadata = _cache_paths(prompt)
    if not path.is_file() or not metadata.is_file():
        raise ValueError("Prepared KREA.2 prompt encoding is missing; encode the saved prompt queue again")
    info = json.loads(metadata.read_text(encoding="utf-8"))
    if info.get("cacheKey") != key or info.get("cacheVersion") != CACHE_VERSION or info.get("promptHash") != hashlib.sha256(prompt.encode()).hexdigest() or info.get("cacheSha256") != _hash(path) or info.get("device") != "cuda":
        raise ValueError("Prepared KREA.2 prompt cache identity/hash mismatch; encode the saved prompt queue again")
    tensors = load_file(str(path), device="cpu")
    if set(tensors) != {"ctx", "mask"}:
        raise ValueError("Cached KREA.2 prompt tensors are invalid")
    _check_context(tensors["ctx"], tensors["mask"])
    if info.get("contextLength") != tensors["ctx"].shape[1]:
        raise ValueError("Cached KREA.2 context length mismatch")
    return tensors["ctx"], tensors["mask"], info


def _strict_shapes(model, shapes, name):
    expected = model.state_dict()
    missing, unexpected = sorted(set(expected) - set(shapes)), sorted(set(shapes) - set(expected))
    wrong = [key for key in expected.keys() & shapes.keys() if tuple(expected[key].shape) != tuple(shapes[key])]
    if missing or unexpected or wrong:
        raise RuntimeError(f"{name} strict preflight: {len(missing)} missing {missing[:2]}; {len(unexpected)} unexpected {unexpected[:2]}; {len(wrong)} shape mismatches {wrong[:2]}")


def _cuda_release():
    import torch
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.synchronize()
        torch.cuda.empty_cache()


def _release():
    global BATCH_PREPARED, ENCODING_STAGE
    MODELS.clear()
    BATCH_PREPARED = False
    ENCODING_STAGE = "idle"
    _cuda_release()
    return {"ok": True, "released": True, "loaded": False}


def _load_encoder():
    import torch
    from transformers import AutoConfig, AutoTokenizer, Qwen3VLModel
    from safetensors import safe_open
    from safetensors.torch import load_file
    if MODELS:
        raise RuntimeError("KREA.2 encoder cannot load while the image model is resident")
    if not torch.cuda.is_available():
        raise RuntimeError("KREA.2 requires CUDA")
    free, _ = torch.cuda.mem_get_info()
    if free < COMPONENTS["text_encoder"][2] + 4 * 1024 ** 3:
        raise RuntimeError("Insufficient free GPU memory for Qwen3-VL-4B text encoding")
    config_path = str(_env("P316_KREA_QWEN_CONFIG"))
    with torch.device("meta"):
        encoder = Qwen3VLModel(AutoConfig.from_pretrained(config_path, local_files_only=True)).eval()
    with safe_open(str(_env("P316_MODEL_KREA2_QWEN")), framework="pt", device="cpu") as checkpoint:
        _strict_shapes(encoder, {key.removeprefix("model."): checkpoint.get_slice(key).get_shape() for key in checkpoint.keys()}, "Qwen3-VL-4B")
    _log("Loading Qwen3-VL-4B text encoder into GPU VRAM.")
    state = {key.removeprefix("model."): value for key, value in load_file(str(_env("P316_MODEL_KREA2_QWEN")), device="cuda").items()}
    encoder.load_state_dict(state, strict=True, assign=True)
    del state
    _materialize_encoder_rotary(encoder)
    encoder = encoder.to(device="cuda", dtype=torch.bfloat16).eval().requires_grad_(False)
    tokenizer = AutoTokenizer.from_pretrained(config_path, local_files_only=True)
    return encoder, tokenizer


def _materialize_encoder_rotary(encoder):
    """Nonpersistent RoPE buffers have no checkpoint entries after meta creation."""
    from transformers.models.qwen3_vl.modeling_qwen3_vl import Qwen3VLVisionRotaryEmbedding, Qwen3VLTextRotaryEmbedding
    old_vision = encoder.visual.rotary_pos_emb
    encoder.visual.rotary_pos_emb = Qwen3VLVisionRotaryEmbedding(old_vision.dim, old_vision.theta)
    encoder.language_model.rotary_emb = Qwen3VLTextRotaryEmbedding(encoder.config.text_config)


def _encode_one(encoder, tokenizer, prompt):
    import torch
    suffix = tokenizer([SUFFIX], return_tensors="pt")
    if suffix["input_ids"].shape[1] != SUFFIX_TOKENS or len(tokenizer(PREFIX)["input_ids"]) != PREFIX_TOKENS:
        raise RuntimeError("KREA.2 pinned tokenizer prompt-template boundary mismatch")
    text = PREFIX + prompt
    length = len(tokenizer(text, truncation=False)["input_ids"])
    length = max(512 + PREFIX_TOKENS - SUFFIX_TOKENS, length)
    if length + SUFFIX_TOKENS - PREFIX_TOKENS > MAX_CONTEXT_TOKENS:
        raise ValueError(f"KREA.2 prompt exceeds {MAX_CONTEXT_TOKENS} context tokens; no text was truncated")
    inputs = tokenizer([text], truncation=False, padding="max_length", max_length=length, return_tensors="pt")
    ids = torch.cat([inputs["input_ids"], suffix["input_ids"]], dim=1).to("cuda")
    mask = torch.cat([inputs["attention_mask"].bool(), suffix["attention_mask"].bool()], dim=1).to("cuda")
    with torch.no_grad():
        states = encoder(input_ids=ids, attention_mask=mask, output_hidden_states=True, use_cache=False)
        ctx = torch.stack([states.hidden_states[i] for i in LAYERS], dim=2)[:, PREFIX_TOKENS:]
        return ctx.to(device="cpu", dtype=torch.bfloat16), mask[:, PREFIX_TOKENS:].to("cpu")


def _encode_prompts(prompts):
    global BATCH_PREPARED, ENCODING_STAGE
    if not isinstance(prompts, list) or not 1 <= len(prompts) <= 100:
        raise ValueError("Encode between 1 and 100 saved prompts")
    prompts = [_prompt(value) for value in prompts]
    _log("Verifying local KREA.2 component files and checkpoint hashes.")
    _identity(verify=True)
    _source()
    _release()
    ENCODING_STAGE = "encoding"
    # Include the exact empty unconditional branch required by RAW classifier-free guidance.
    unique = list(dict.fromkeys([*prompts, ""]))
    entries, missing = {}, []
    for prompt in unique:
        try:
            _, _, entries[prompt] = _load_context(prompt)
        except (OSError, ValueError, KeyError, RuntimeError):
            missing.append(prompt)
    encoder = tokenizer = encoder_ref = None
    started = time.perf_counter()
    try:
        if missing:
            import weakref
            encoder, tokenizer = _load_encoder()
            encoder_ref = weakref.ref(encoder)
            for index, prompt in enumerate(missing):
                _log(f"Encoding prompt {index + 1}/{len(missing)} on GPU; no truncation.")
                t0 = time.perf_counter()
                ctx, mask = _encode_one(encoder, tokenizer, prompt)
                entries[prompt] = _store_context(prompt, ctx, mask, (time.perf_counter() - t0) * 1000)
                del ctx, mask
                _log(f"Prompt {index + 1}/{len(missing)} encoded in {entries[prompt]['encodeMs'] / 1000:.1f} seconds.")
    finally:
        _log("Unloading the GPU text encoder before image generation.")
        del encoder, tokenizer
        _cuda_release()
        if encoder_ref is not None and encoder_ref() is not None:
            raise RuntimeError("GPU text encoder objects were not released; image model remains unloaded")
    import torch
    free, _ = torch.cuda.mem_get_info()
    if free < COMPONENTS["transformer"][2] + COMPONENTS["vae"][2] + 4 * 1024 ** 3:
        raise RuntimeError("Text encoder released but insufficient free VRAM remains for KREA.2 generation")
    _log("Text encoder unload confirmed. All saved prompt encodings are ready.")
    BATCH_PREPARED, ENCODING_STAGE = True, "ready"
    return {"ok": True, "promptCount": len(prompts), "cachedPromptCount": len(prompts), "encoderReleased": True,
            "textEncoderDevice": "cuda", "encodeMs": (time.perf_counter() - started) * 1000,
            "cacheEntries": [entries[prompt] for prompt in prompts]}


def _flow_config():
    from mmdit import SingleMMDiTConfig
    return SingleMMDiTConfig(features=6144, tdim=256, txtdim=2560, heads=48, kvheads=12, multiplier=4, layers=28,
                            patch=2, channels=16, txtheads=20, txtkvheads=20, txtlayers=12)


def _configure_eager_mmdit():
    """Use the official operations without compiler wrappers on the Windows worker.

    TORCH_COMPILE_DISABLE alone leaves fullgraph decorators that fail under
    current PyTorch. Unwrap only the three compiled methods in pinned mmdit;
    model weights and numerical operations remain unchanged.
    """
    import inspect
    import mmdit
    for name in ("PositionalEncoding", "RMSNorm", "LastLayer"):
        cls = getattr(mmdit, name)
        cls.forward = inspect.unwrap(cls.forward)


def _load_base():
    if "flow" in MODELS:
        _log("Reusing the loaded KREA.2 RAW image model.")
        return 0.0
    import torch
    from safetensors import safe_open
    from safetensors.torch import load_file
    from diffusers import AutoencoderKLQwenImage
    from diffusers.loaders.single_file_utils import convert_wan_vae_to_diffusers
    from mmdit import SingleStreamDiT
    _configure_eager_mmdit()
    started = time.perf_counter()
    if not BATCH_PREPARED:
        raise RuntimeError("Encode and unload the text encoder before loading KREA.2 RAW")
    free, _ = torch.cuda.mem_get_info()
    if free < COMPONENTS["transformer"][2] + COMPONENTS["vae"][2] + 4 * 1024 ** 3:
        raise RuntimeError("Insufficient free GPU memory for KREA.2 RAW and working space")
    with torch.device("meta"):
        flow = SingleStreamDiT(_flow_config()).eval()
        vae = AutoencoderKLQwenImage.from_config(json.loads((_env("P316_KREA_VAE_CONFIG") / "config.json").read_text()))
    with safe_open(str(_env("P316_MODEL_KREA2")), framework="pt", device="cpu") as checkpoint:
        _strict_shapes(flow, {key: checkpoint.get_slice(key).get_shape() for key in checkpoint.keys()}, "KREA.2 RAW")
    vae_state = convert_wan_vae_to_diffusers(load_file(str(_env("P316_MODEL_KREA2_VAE")), device="cpu"))
    _strict_shapes(vae, {key: value.shape for key, value in vae_state.items()}, "KREA.2 VAE")
    _log("Loading KREA.2 RAW image model and VAE into GPU VRAM.")
    flow.load_state_dict(load_file(str(_env("P316_MODEL_KREA2")), device="cuda"), strict=True, assign=True)
    vae.load_state_dict(vae_state, strict=True, assign=True)
    del vae_state
    MODELS.update(flow=flow.to(device="cuda", dtype=torch.bfloat16).eval().requires_grad_(False),
                  vae=vae.to(device="cuda", dtype=torch.bfloat16).eval().requires_grad_(False))
    gc.collect()
    torch.cuda.empty_cache()
    return (time.perf_counter() - started) * 1000


def _validate_generate(msg):
    if set(msg) - {"id", "method", "prompt", "out", "width", "height", "seed", "references"}:
        raise ValueError("Unsupported KREA.2 generation controls")
    if msg.get("references"):
        raise ValueError("KREA.2 RAW is text-to-image only; image-reference conditioning is unsupported")
    if (msg.get("width"), msg.get("height")) not in [(512, 512), (1024, 1024), (1536, 1024)]:
        raise ValueError("KREA.2 RAW accepts 512x512, 1024x1024 or 1536x1024 output")
    seed = msg.get("seed", 0)
    if isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed <= 2147483647:
        raise ValueError("Seed is out of range")
    root = _env("P316_OUTPUT_ROOT").resolve(strict=True)
    out = Path(str(msg.get("out", "")))
    if not out.is_absolute() or not out.parent.resolve(strict=True).is_relative_to(root) or out.name.startswith(".") or out.suffix != ".png" or ":" in out.name:
        raise ValueError("Output path escapes the app media root or has an invalid name")
    return {"prompt": _prompt(msg.get("prompt")), "out": out, "width": msg["width"], "height": msg["height"], "seed": seed}


def _generate(req):
    global ENCODING_STAGE
    started = time.perf_counter()
    _identity(verify=True)
    _source()
    if not BATCH_PREPARED:
        _encode_prompts([req["prompt"]])
    # Strict validation happens before model loading; a changed/missing cache cannot use stale context.
    ctx, mask, info = _load_context(req["prompt"])
    del ctx, mask
    ctx, mask, _ = _load_context("")
    del ctx, mask
    import torch
    from einops import rearrange
    from sampling import sample
    resident = "flow" in MODELS
    load_ms = _load_base()
    ENCODING_STAGE = "generating"
    decode_ms = 0.0

    class CachedEncoder:
        def __call__(self, prompts):
            if len(prompts) != 1:
                raise ValueError("KREA.2 image generation is serialized")
            ctx, mask, _ = _load_context(prompts[0])
            return ctx.to("cuda"), mask.to("cuda")

    class FlowProgress:
        config = MODELS["flow"].config
        calls = 0
        def __call__(self, **kwargs):
            result = MODELS["flow"](**kwargs)
            self.calls += 1
            if self.calls % 2 == 0:
                _log(f"Sampling step {self.calls // 2}/{STEPS} completed.")
            return result

    class Decoder:
        compression, channels = 8, 16
        def decode(self, latent):
            nonlocal decode_ms
            _log("Sampling finished. Decoding the generated image.")
            t0 = time.perf_counter()
            vae = MODELS["vae"]
            latent = rearrange(latent, "b c h w -> b c 1 h w")
            mean = torch.tensor(vae.latents_mean, device=latent.device, dtype=latent.dtype).view(1, -1, 1, 1, 1)
            std = torch.tensor(vae.latents_std, device=latent.device, dtype=latent.dtype).view(1, -1, 1, 1, 1)
            decoded = vae.decode(latent * std + mean).sample
            decode_ms = (time.perf_counter() - t0) * 1000
            return rearrange(decoded, "b c 1 h w -> b c h w")

    _log(f"Sampling KREA.2 RAW at {req['width']}x{req['height']}: {STEPS} steps, CFG {GUIDANCE}.")
    infer_started = time.perf_counter()
    with torch.no_grad():
        images = sample(FlowProgress(), Decoder(), CachedEncoder(), [req["prompt"]], width=req["width"], height=req["height"], steps=STEPS, guidance=GUIDANCE, seed=req["seed"])
    inference_ms = (time.perf_counter() - infer_started) * 1000 - decode_ms
    if images[0].size != (req["width"], req["height"]):
        raise RuntimeError("KREA.2 returned unexpected image dimensions")
    tmp = req["out"].with_suffix(".tmp.png")
    images[0].save(tmp)
    os.replace(tmp, req["out"])
    ENCODING_STAGE = "ready"
    total_ms = (time.perf_counter() - started) * 1000
    _log(f"Image saved. Total generation time: {total_ms / 1000:.1f} seconds.")
    return {"ok": True, "engine": "krea-2", "model": "krea2-raw", "seed": req["seed"], "loaded": True,
            "referencesUsed": [], "conditioningMode": "text-only", "workerIdentity": IDENTITY, "componentDigest": _digest(IDENTITY),
            "textEncoding": {"device": "cuda", "cached": True, **{key: info[key] for key in ["cacheKey", "cacheSha256", "contextLength", "encodeMs"]}},
            "telemetry": {"modelLoadMs": load_ms, "loadMs": load_ms, "encodeMs": 0, "inferenceMs": inference_ms,
                          "decodeMs": decode_ms, "totalMs": total_ms, "peakVramBytes": int(torch.cuda.max_memory_allocated()),
                          "peakSystemRamBytes": None, "residentBeforeJob": resident, "residentAfterJob": True}}


def handle(msg):
    method, request_id = msg.get("method"), msg.get("id")
    if method == "ping":
        identity = _identity()
        result = {"ok": True, "loaded": "flow" in MODELS, "batchPrepared": BATCH_PREPARED, "encodingStage": ENCODING_STAGE,
                  "workerIdentity": identity, "componentDigest": _digest(identity)}
    elif method == "release":
        result = _release()
    elif method == "encode_prompts":
        if set(msg) - {"id", "method", "prompts"}:
            raise ValueError("Unsupported prompt encoding controls")
        result = _encode_prompts(msg.get("prompts"))
    elif method == "generate":
        result = _generate(_validate_generate(msg))
    else:
        raise ValueError("Unsupported worker method")
    _emit({"id": request_id, **result})


if __name__ == "__main__":
    for line in sys.stdin:
        if not line.strip():
            continue
        msg = {}
        try:
            msg = json.loads(line)
            handle(msg)
        except Exception as exc:
            traceback.print_exc(file=sys.stderr)
            _emit({"id": msg.get("id"), "ok": False, "code": type(exc).__name__, "error": str(exc)})
