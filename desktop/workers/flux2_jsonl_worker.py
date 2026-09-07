"""Premiere316 app-owned FLUX.2 Dev JSONL worker.

Packaged resource spawned only after backend one-use authorization. It loads the
official local black-forest-labs/flux2 classes, never contacts the network, never
uses a Comfy graph runtime, and never falls through to Hugging Face weight lookup.
"""
from __future__ import annotations

import gc
import hashlib
import json
import os
import sys
import traceback
from pathlib import Path
from typing import Any

PROTOCOL_VERSION = "premiere316.flux2-jsonl.v1"
WIDTH = 512
HEIGHT = 512
STEPS = 50
GUIDANCE = 4.0
SCHEDULE_ID = "flux2-empirical-snr"
PROMPT_LIMIT = 4000
FLUX2_SOURCE_HEAD = "50fe5162777813d869182b139e83b10743caef15"
MISTRAL_REVISION = "95a6d26c4bfb886c58daf9d3f7332c857cb27b43"
PROCESSOR_REVISION = "68faf511d618ef198fef186659617cfd2eb8e33a"
EXPECTED = {
    "flux2": ("P316_MODEL_FLUX2", "6159a3f19f829c8e84ba6e9996b7afaf7c0a5f3428677f5b37445778a320d275", 64_446_596_128),
    "ae": ("P316_MODEL_FLUX2_AE", "d64f3a68e1cc4f9f4e29b6e0da38a0204fe9a49f2d4053f0ec1fa1ca02f9c4b5", 336_213_556),
}
MISTRAL_CONFIG_HASH = "01ab910a5dda7995709cc355d094eabb8094b78d49240cd167188606c3ff5edb"
MISTRAL_INDEX_HASH = "664a049408e8694e5867312145b74b1971ad5472061a1f176e0806dec9b3d21c"
PROCESSOR_CONFIG_HASH = "ce3ec410cac74da358f786c574b73b6624c50c8bb876bcb628f06500fe07adcc"
PROCESSOR_TOKENIZER_HASH = "b76085f9923309d873994d444989f7eb6ec074b06f25b58f1e8d7b7741070949"
MISTRAL_SHARDS = {
    "model-00001-of-00010.safetensors": 4_883_550_696,
    "model-00002-of-00010.safetensors": 4_781_593_336,
    "model-00003-of-00010.safetensors": 4_886_472_224,
    "model-00004-of-00010.safetensors": 4_781_593_376,
    "model-00005-of-00010.safetensors": 4_781_593_368,
    "model-00006-of-00010.safetensors": 4_886_472_248,
    "model-00007-of-00010.safetensors": 4_781_593_376,
    "model-00008-of-00010.safetensors": 4_781_593_368,
    "model-00009-of-00010.safetensors": 4_886_472_248,
    "model-00010-of-00010.safetensors": 4_571_866_320,
}

for _key in [
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "HF_TOKEN", "HUGGING_FACE_HUB_TOKEN",
    "XAI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY",
    "AZURE_OPENAI_API_KEY", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
    "OPENROUTER_API_KEY", "BFL_API_KEY",
]:
    os.environ.pop(_key, None)
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_DATASETS_OFFLINE"] = "1"
os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

SESSION: dict[str, Any] | None = None
MODELS: dict[str, Any] = {}


def _emit(record: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(record, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def _err(msg_id: Any, code: str, message: str) -> None:
    _emit({"id": msg_id, "ok": False, "code": code, "error": message})


def _path_env(name: str) -> Path:
    value = os.environ.get(name, "")
    if not value:
        raise RuntimeError(f"Missing worker environment {name}")
    return Path(value)


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _identity(static_only: bool = False) -> dict[str, Any]:
    components: dict[str, Any] = {}
    for role, (env_name, expected_hash, expected_size) in EXPECTED.items():
        path = _path_env(env_name)
        size = path.stat().st_size if path.exists() else 0
        item = {"pathName": path.name, "expectedSha256": expected_hash, "sizeBytes": size, "expectedSizeBytes": expected_size, "present": path.exists() and size == expected_size}
        if not static_only and item["present"]:
            item["sha256"] = _sha256_file(path)
            item["hashOk"] = item["sha256"] == expected_hash
        components[role] = item
    mistral = _path_env("P316_MISTRAL_MODEL")
    processor = _path_env("P316_MISTRAL_PROCESSOR")
    shards = {name: (mistral / name).exists() and (mistral / name).stat().st_size == size for name, size in MISTRAL_SHARDS.items()}
    components["mistral"] = {
        "revision": MISTRAL_REVISION,
        "configSha256": _sha256_file(mistral / "config.json") if (mistral / "config.json").exists() else None,
        "indexSha256": _sha256_file(mistral / "model.safetensors.index.json") if (mistral / "model.safetensors.index.json").exists() else None,
        "shardsPresent": all(shards.values()),
        "present": (mistral / "config.json").exists() and (mistral / "model.safetensors.index.json").exists() and all(shards.values()),
    }
    components["processor"] = {
        "revision": PROCESSOR_REVISION,
        "configSha256": _sha256_file(processor / "config.json") if (processor / "config.json").exists() else None,
        "tokenizerSha256": _sha256_file(processor / "tokenizer.json") if (processor / "tokenizer.json").exists() else None,
        "present": (processor / "config.json").exists() and (processor / "tokenizer.json").exists(),
    }
    worker_file = Path(os.environ.get("P316_WORKER_FILE", __file__))
    return {
        "workerProtocolVersion": PROTOCOL_VERSION,
        "workerSha256": _sha256_file(worker_file) if worker_file.exists() else None,
        "runtime": "black-forest-labs/flux2",
        "flux2SourceHead": FLUX2_SOURCE_HEAD,
        "fixedWidth": WIDTH,
        "fixedHeight": HEIGHT,
        "steps": STEPS,
        "guidance": GUIDANCE,
        "scheduleId": SCHEDULE_ID,
        "supportsReferences": False,
        "components": components,
    }


def _component_digest(identity: dict[str, Any]) -> str:
    public = json.dumps(identity, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(public).hexdigest()


def _validate_component_identity(identity: dict[str, Any]) -> None:
    for role in ["flux2", "ae"]:
        item = identity["components"][role]
        if not item["present"] or item.get("sha256") != item.get("expectedSha256"):
            raise RuntimeError(f"{role} component identity mismatch")
    mistral = identity["components"]["mistral"]
    if not mistral["present"] or mistral["configSha256"] != MISTRAL_CONFIG_HASH or mistral["indexSha256"] != MISTRAL_INDEX_HASH:
        raise RuntimeError("Mistral-Small 3.2 snapshot identity mismatch")
    processor = identity["components"]["processor"]
    if not processor["present"] or processor["configSha256"] != PROCESSOR_CONFIG_HASH or processor["tokenizerSha256"] != PROCESSOR_TOKENIZER_HASH:
        raise RuntimeError("Mistral processor snapshot identity mismatch")


def _assert_official_flux2_env_bindings() -> None:
    for official, app_pin in [("FLUX2_MODEL_PATH", "P316_MODEL_FLUX2"), ("AE_MODEL_PATH", "P316_MODEL_FLUX2_AE")]:
        official_path = _path_env(official).resolve()
        pinned_path = _path_env(app_pin).resolve()
        if official_path != pinned_path:
            raise RuntimeError(f"{official} is not bound to the approved Premiere316 {app_pin} path")


def _validate_request(msg: dict[str, Any]) -> dict[str, Any]:
    allowed = {"id", "method", "prompt", "out", "width", "height", "seed"}
    forbidden = set(msg) - allowed
    explicit_forbidden = forbidden | {key for key in ["refs", "references", "negativePrompt", "mask", "loras", "batch", "steps", "guidance", "scheduler", "precision", "control", "controls"] if key in msg}
    if explicit_forbidden:
        raise ValueError(f"Unsupported FLUX.2 JSONL keys: {', '.join(sorted(explicit_forbidden))}")
    if msg.get("method") != "generate":
        raise ValueError("Unsupported method")
    prompt = str(msg.get("prompt", "")).strip()
    if not prompt or len(prompt) > PROMPT_LIMIT:
        raise ValueError("Prompt is empty or too long")
    if msg.get("width") != WIDTH or msg.get("height") != HEIGHT:
        raise ValueError("FLUX.2 Dev worker currently accepts 512x512 T2I output")
    seed = int(msg.get("seed", 0))
    if seed < 0 or seed > 2_147_483_647:
        raise ValueError("Seed is out of range")
    out = _safe_output_path(str(msg.get("out", "")))
    return {"prompt": prompt, "seed": seed, "out": out}


def _safe_output_path(raw: str) -> Path:
    output_root = _path_env("P316_OUTPUT_ROOT").resolve()
    if not raw:
        raise ValueError("Missing output path")
    path = Path(raw)
    if not path.is_absolute():
        raise ValueError("Output path must be absolute")
    parent = path.parent.resolve(strict=True)
    root = output_root.resolve(strict=True)
    if os.path.commonpath([str(parent), str(root)]) != str(root):
        raise ValueError("Output path escapes P316_OUTPUT_ROOT")
    if path.name.startswith(".") or not path.name.endswith(".png") or any(sep in path.name for sep in ["/", "\\", ":"]):
        raise ValueError("Invalid output filename")
    return path


def _rss_bytes() -> int | None:
    try:
        import resource
        value = int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
        return value * 1024 if value < 10_000_000_000 else value
    except Exception:
        return None


def _cuda_memory() -> int | None:
    try:
        import torch
        if torch.cuda.is_available():
            return int(torch.cuda.max_memory_allocated())
    except Exception:
        return None
    return None


def _load_offline_mistral(device: str):
    import torch
    import torch.nn as nn
    from einops import rearrange
    from transformers import AutoProcessor, Mistral3ForConditionalGeneration
    from flux2.system_messages import SYSTEM_MESSAGE

    model_dir = str(_path_env("P316_MISTRAL_MODEL"))
    processor_dir = str(_path_env("P316_MISTRAL_PROCESSOR"))
    model = Mistral3ForConditionalGeneration.from_pretrained(
        model_dir,
        torch_dtype=torch.bfloat16,
        local_files_only=True,
    ).eval()
    model.to("cpu")
    processor = AutoProcessor.from_pretrained(processor_dir, use_fast=False, local_files_only=True)

    class OfflineMistralEmbedder(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.model = model
            self.processor = processor
            self.max_length = 512

        def format_input(self, txt: list[str]):
            cleaned = [prompt.replace("[IMG]", "") for prompt in txt]
            return [
                [
                    {"role": "system", "content": [{"type": "text", "text": SYSTEM_MESSAGE}]},
                    {"role": "user", "content": [{"type": "text", "text": prompt}]},
                ]
                for prompt in cleaned
            ]

        @torch.no_grad()
        def forward(self, txt: list[str]):
            messages_batch = self.format_input(txt)
            inputs = self.processor.apply_chat_template(
                messages_batch,
                add_generation_prompt=False,
                tokenize=True,
                return_dict=True,
                return_tensors="pt",
                padding="max_length",
                truncation=True,
                max_length=self.max_length,
            )
            input_ids = inputs["input_ids"].to(self.model.device)
            attention_mask = inputs["attention_mask"].to(self.model.device)
            output = self.model(
                input_ids=input_ids,
                attention_mask=attention_mask,
                output_hidden_states=True,
                use_cache=False,
            )
            out = torch.stack([output.hidden_states[k] for k in [10, 20, 30]], dim=1)
            return rearrange(out, "b c l d -> b l (c d)")

    return OfflineMistralEmbedder()


def _load_session() -> dict[str, Any]:
    global SESSION, MODELS
    if SESSION is not None:
        return SESSION
    t0 = __import__("time").perf_counter()
    identity = _identity(static_only=False)
    _validate_component_identity(identity)
    _assert_official_flux2_env_bindings()

    flux2_src = _path_env("P316_BFL_FLUX2_SOURCE_ROOT")
    if str(flux2_src) not in sys.path:
        sys.path.insert(0, str(flux2_src))

    import time
    import torch
    from safetensors.torch import load_file
    from flux2.autoencoder import AutoEncoder, AutoEncoderParams
    from flux2.model import Flux2, Flux2Params

    torch.set_grad_enabled(False)
    if not torch.cuda.is_available():
        raise RuntimeError("FLUX.2 Dev requires CUDA")
    device = "cuda"
    dtype = torch.bfloat16

    text_encoder = _load_offline_mistral(device)

    with torch.device("meta"):
        flow = Flux2(Flux2Params()).eval().to(dtype=dtype)
        ae = AutoEncoder(AutoEncoderParams()).eval()
    flow_state = load_file(str(_path_env("P316_MODEL_FLUX2")), device=device)
    flow.load_state_dict(flow_state, strict=True, assign=True)
    del flow_state
    ae_state = load_file(str(_path_env("P316_MODEL_FLUX2_AE")), device=device)
    ae.load_state_dict(ae_state, strict=True, assign=True)
    del ae_state
    ae.to(device)
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    MODELS = {"torch": torch, "device": device, "dtype": dtype, "text_encoder": text_encoder, "flow": flow, "ae": ae}
    SESSION = {"loaded": True, "loadMs": (time.perf_counter() - t0) * 1000, "identity": identity, "componentDigest": _component_digest(identity)}
    return SESSION


def _generate(req: dict[str, Any]) -> dict[str, Any]:
    import time
    from einops import rearrange
    from PIL import Image
    from flux2.sampling import batched_prc_img, batched_prc_txt, denoise, get_schedule, scatter_ids

    t0 = time.perf_counter()
    resident_before_job = SESSION is not None
    session = _load_session()
    torch = MODELS["torch"]
    device = MODELS["device"]
    encode_t = time.perf_counter()
    with torch.no_grad():
        ctx = MODELS["text_encoder"]([req["prompt"]]).to(device=device, dtype=MODELS["dtype"])
        ctx, ctx_ids = batched_prc_txt(ctx)
    encode_ms = (time.perf_counter() - encode_t) * 1000
    infer_t = time.perf_counter()
    with torch.no_grad():
        shape = (1, 128, HEIGHT // 16, WIDTH // 16)
        generator = torch.Generator(device=device).manual_seed(req["seed"])
        randn = torch.randn(shape, generator=generator, dtype=MODELS["dtype"], device=device)
        x, x_ids = batched_prc_img(randn)
        timesteps = get_schedule(STEPS, x.shape[1])
        x = denoise(MODELS["flow"], x, x_ids, ctx, ctx_ids, timesteps=timesteps, guidance=GUIDANCE)
        x = torch.cat(scatter_ids(x, x_ids)).squeeze(2)
    inference_ms = (time.perf_counter() - infer_t) * 1000
    decode_t = time.perf_counter()
    with torch.no_grad():
        x = MODELS["ae"].decode(x).float().clamp(-1, 1)
        x = rearrange(x[0], "c h w -> h w c")
        img = Image.fromarray((127.5 * (x + 1.0)).cpu().byte().numpy())
    tmp = req["out"].with_suffix(".tmp.png")
    img.save(tmp)
    os.replace(tmp, req["out"])
    decode_ms = (time.perf_counter() - decode_t) * 1000
    total_ms = (time.perf_counter() - t0) * 1000
    return {
        "ok": True,
        "engine": "flux2",
        "model": "flux2-dev",
        "seed": req["seed"],
        "loaded": True,
        "workerIdentity": session["identity"],
        "componentDigest": session["componentDigest"],
        "telemetry": {
            "modelLoadMs": 0 if resident_before_job else session["loadMs"],
            "loadMs": 0 if resident_before_job else session["loadMs"],
            "encodeMs": encode_ms,
            "inferenceMs": inference_ms,
            "decodeMs": decode_ms,
            "totalMs": total_ms,
            "peakVramBytes": _cuda_memory(),
            "maxCudaMemoryBytes": _cuda_memory(),
            "peakSystemRamBytes": _rss_bytes(),
            "processRamBytes": _rss_bytes(),
            "residentBeforeJob": resident_before_job,
            "residentAfterJob": True,
        },
    }


def _release() -> dict[str, Any]:
    global SESSION, MODELS
    MODELS.clear()
    SESSION = None
    gc.collect()
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass
    return {"ok": True, "released": True, "loaded": False, "processRamBytes": _rss_bytes()}


def handle(msg: dict[str, Any]) -> None:
    msg_id = msg.get("id")
    method = msg.get("method")
    if method == "ping":
        identity = _identity(static_only=True)
        _emit({"id": msg_id, "ok": True, "loaded": SESSION is not None, "workerIdentity": identity, "componentDigest": _component_digest(identity)})
        return
    if method == "release":
        _emit({"id": msg_id, **_release()})
        return
    if method == "generate":
        req = _validate_request(msg)
        _emit({"id": msg_id, **_generate(req)})
        return
    _err(msg_id, "UNKNOWN_METHOD", "Unsupported worker method")


for line in sys.stdin:
    if not line.strip():
        continue
    try:
        handle(json.loads(line))
    except Exception as exc:
        traceback.print_exc(file=sys.stderr)
        failed_id = None
        try:
            failed_id = json.loads(line).get("id")
        except Exception:
            failed_id = None
        _err(failed_id, exc.__class__.__name__, str(exc))
