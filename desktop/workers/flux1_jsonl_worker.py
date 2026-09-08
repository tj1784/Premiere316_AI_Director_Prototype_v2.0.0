"""Premiere316 app-owned FLUX.1 JSONL worker.

This source is packaged as a Premiere316 resource and is only spawned by the
visible prepared-asset Generate action after backend one-use authorization. It
never imports external graph runtimes, never contacts the network, and never uses
remote weight lookup for standalone encoders.
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

PROTOCOL_VERSION = "premiere316.flux1-jsonl.v1"
WIDTH = 512
HEIGHT = 512
STEPS = 20
GUIDANCE = 3.5
SCHEDULE_ID = "flux1-official-20-guidance-3.5"
PROMPT_LIMIT = 4000
EXPECTED = {
    "flux": ("P316_MODEL_FLUX", "4610115bb0c89560703c892c59ac2742fa821e60ef5871b33493ba544683abd7", 23_802_932_552),
    "ae": ("P316_MODEL_AE", "afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38", 335_304_388),
    "t5": ("P316_MODEL_T5", "6e480b09fae049a72d2a8c5fbccb8d3e92febeb233bbe9dfe7256958a9167635", 9_787_841_024),
    "clip": ("P316_MODEL_CLIP", "660c6f5b1abae9dc498ac2d21e1347d2abdb0cf6c0c0c8576cd796491d9a6cdd", 246_144_152),
    "bpe": ("P316_OPENCLIP_BPE", "924691ac288e54409236115652ad4aa250f48203de50a9e4722a6ecd48d6804a", 1_356_917),
    "openclipTokenizer": ("P316_OPENCLIP_TOKENIZER", "90d743e462d051f4c921e652e0aa8af06c40ee7ac38dfdc7bb5ede6381024734", 22_680),
}
T5_CONFIG_HASH = "a58c2192a7166501ad2382c3d7ca3d694a1259b71a23a1925887e5afe7adcbd8"
T5_SPIECE_HASH = "d60acb128cf7b7f2536e8f38a5b18a05535c9e14c7a355904270e15b0945ea86"
T5_REVISION = "3db67ab1af984cf10548a73467f0e5bca2aaaeb2"
FLUX_SOURCE_HEAD = "802fb4713906133fcbd0d8dc5351620ca4773036"

# Strip cloud/proxy/token environment. Keep this list explicit so tests can
# verify that no ambient API account or proxy is inherited by the worker.
for _key in [
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "HF_TOKEN", "HUGGING_FACE_HUB_TOKEN",
    "XAI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY",
    "AZURE_OPENAI_API_KEY", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
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
    config_dir = _path_env("P316_T5_CONFIG_DIR")
    components["t5Config"] = {
        "revision": T5_REVISION,
        "configSha256": _sha256_file(config_dir / "config.json") if (config_dir / "config.json").exists() else None,
        "spieceSha256": _sha256_file(config_dir / "spiece.model") if (config_dir / "spiece.model").exists() else None,
        "present": all((config_dir / name).exists() for name in ["config.json", "tokenizer_config.json", "special_tokens_map.json", "spiece.model"]),
    }
    worker_file = Path(os.environ.get("P316_WORKER_FILE", __file__))
    return {
        "workerProtocolVersion": PROTOCOL_VERSION,
        "workerSha256": _sha256_file(worker_file) if worker_file.exists() else None,
        "runtime": "black-forest-labs/flux",
        "fluxSourceHead": FLUX_SOURCE_HEAD,
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
    for role, item in identity["components"].items():
        if role == "t5Config":
            if not item["present"] or item["configSha256"] != T5_CONFIG_HASH or item["spieceSha256"] != T5_SPIECE_HASH:
                raise RuntimeError("T5 config/tokenizer snapshot identity mismatch")
            continue
        if not item["present"] or item.get("sha256") != item.get("expectedSha256"):
            raise RuntimeError(f"{role} component identity mismatch")


def _assert_official_flux_env_bindings() -> None:
    # BFL helper functions resolve through FLUX_MODEL/FLUX_AE. Require those
    # official variables to be byte-for-byte identical to the audited app pins
    # before import/load so helper checkpoint lookup cannot fall through to any
    # runtime cache, repo default, or download location.
    for official, app_pin in [("FLUX_MODEL", "P316_MODEL_FLUX"), ("FLUX_AE", "P316_MODEL_AE")]:
        official_path = _path_env(official).resolve()
        pinned_path = _path_env(app_pin).resolve()
        if official_path != pinned_path:
            raise RuntimeError(f"{official} is not bound to the approved Premiere316 {app_pin} path")


def _validate_request(msg: dict[str, Any]) -> dict[str, Any]:
    allowed = {"id", "method", "prompt", "out", "width", "height", "seed"}
    forbidden = set(msg) - allowed
    explicit_forbidden = forbidden | {key for key in ["refs", "references", "negativePrompt", "mask", "loras", "batch", "steps", "guidance", "scheduler", "precision", "control", "controls"] if key in msg}
    if explicit_forbidden:
      raise ValueError(f"Unsupported FLUX.1 JSONL keys: {', '.join(sorted(explicit_forbidden))}")
    if msg.get("method") != "generate":
        raise ValueError("Unsupported method")
    prompt = str(msg.get("prompt", "")).strip()
    if not prompt or len(prompt) > PROMPT_LIMIT:
        raise ValueError("Prompt is empty or too long")
    if msg.get("width") != WIDTH or msg.get("height") != HEIGHT:
        raise ValueError("FLUX.1 worker only accepts 512x512 output")
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


def _strict_load_state(module: Any, state: dict[str, Any], expected_count: int, label: str) -> None:
    if len(state) != expected_count:
        raise RuntimeError(f"{label} tensor count mismatch")
    missing, unexpected = module.load_state_dict(state, strict=True)
    if missing or unexpected:
        raise RuntimeError(f"{label} state mismatch: missing={missing} unexpected={unexpected}")


def _load_session() -> dict[str, Any]:
    global SESSION, MODELS
    if SESSION is not None:
        return SESSION
    t0 = time.perf_counter()
    identity = _identity(static_only=False)
    _validate_component_identity(identity)
    _assert_official_flux_env_bindings()

    flux_src = _path_env("P316_BFL_FLUX_SOURCE_ROOT")
    if str(flux_src) not in sys.path:
        sys.path.insert(0, str(flux_src))

    import torch
    from safetensors.torch import load_file
    from transformers import CLIPConfig, CLIPTextConfig, CLIPTextModel, T5Config, T5EncoderModel, T5Tokenizer
    import importlib.util
    from flux.model import Flux, FluxParams
    from flux.modules.autoencoder import AutoEncoder, AutoEncoderParams

    torch.set_grad_enabled(False)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.bfloat16 if device == "cuda" else torch.float32

    t5_config = T5Config.from_json_file(str(_path_env("P316_T5_CONFIG_DIR") / "config.json"))
    t5 = T5EncoderModel(t5_config).eval()
    t5_state = load_file(str(_path_env("P316_MODEL_T5")), device="cpu")
    required_t5_shapes = {
        "shared.weight": (32128, 4096),
        "encoder.embed_tokens.weight": (32128, 4096),
        "encoder.block.0.layer.0.SelfAttention.relative_attention_bias.weight": (32, 64),
        "encoder.final_layer_norm.weight": (4096,),
    }
    for key, shape in required_t5_shapes.items():
        if key not in t5_state or tuple(t5_state[key].shape) != shape:
            raise RuntimeError("T5 standalone state schema mismatch")
    _strict_load_state(t5, t5_state, 220, "T5")
    del t5_state
    t5.to(device=device, dtype=dtype)
    t5_tokenizer = T5Tokenizer(vocab_file=str(_path_env("P316_T5_CONFIG_DIR") / "spiece.model"), model_max_length=512)

    clip_text = CLIPTextConfig(vocab_size=49408, hidden_size=768, intermediate_size=3072, num_hidden_layers=12, num_attention_heads=12, max_position_embeddings=77, hidden_act="quick_gelu")
    clip = CLIPTextModel(CLIPConfig(text_config=clip_text.to_dict()).text_config).eval()
    clip_state = load_file(str(_path_env("P316_MODEL_CLIP")), device="cpu")
    if len(clip_state) != 196 or tuple(clip_state["text_model.embeddings.token_embedding.weight"].shape) != (49408, 768):
        raise RuntimeError("CLIP-L standalone state schema mismatch")
    # The audited standalone file uses the historical Hugging Face
    # `text_model.*` namespace. The installed CLIPTextModel implementation owns
    # embeddings/encoder/final_layer_norm directly, so normalize that one exact
    # prefix before strict loading. Reject mixed/unprefixed files and collisions;
    # this is a key-name adaptation only, never a weight conversion.
    if not all(key.startswith("text_model.") for key in clip_state):
        raise RuntimeError("CLIP-L standalone state namespace mismatch")
    normalized_clip_state = {key.removeprefix("text_model."): value for key, value in clip_state.items()}
    if len(normalized_clip_state) != len(clip_state):
        raise RuntimeError("CLIP-L normalized state contains duplicate keys")
    _strict_load_state(clip, normalized_clip_state, 196, "CLIP-L")
    del normalized_clip_state, clip_state
    clip.to(device=device, dtype=dtype)
    tokenizer_py = _path_env("P316_OPENCLIP_TOKENIZER")
    spec = importlib.util.spec_from_file_location("p316_openclip_tokenizer", str(tokenizer_py))
    if spec is None or spec.loader is None:
        raise RuntimeError("OpenCLIP tokenizer module could not be loaded by exact path")
    tokenizer_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(tokenizer_module)
    clip_tokenizer = tokenizer_module.SimpleTokenizer(bpe_path=str(_path_env("P316_OPENCLIP_BPE")))

    # Official BFL model/AE classes are constructed directly with audited flux-dev
    # params. Do not call flux.util load_* helpers: those are repo/checkpoint loader
    # conveniences and are deliberately kept out of this worker's trust boundary.
    flux_params = FluxParams(in_channels=64, out_channels=64, vec_in_dim=768, context_in_dim=4096, hidden_size=3072, mlp_ratio=4.0, num_heads=24, depth=19, depth_single_blocks=38, axes_dim=[16, 56, 56], theta=10_000, qkv_bias=True, guidance_embed=True)
    ae_params = AutoEncoderParams(resolution=256, in_channels=3, ch=128, out_ch=3, ch_mult=[1, 2, 4, 4], num_res_blocks=2, z_channels=16, scale_factor=0.3611, shift_factor=0.1159)
    with torch.device("meta"):
        # Preserve the audited BF16 transformer checkpoint dtype while the
        # module is still metadata-only. Calling to_empty on a default-FP32
        # meta module would create FP32 CUDA parameters and later make the
        # official BF16 sampling input fail at img_in. The AE checkpoint is
        # audited FP32 and intentionally remains FP32 for decode.
        flow = Flux(flux_params).eval().to(dtype=dtype)
        ae = AutoEncoder(ae_params).eval()
    flow.to_empty(device=device)
    ae.to_empty(device=device)
    flow_state = load_file(str(_path_env("P316_MODEL_FLUX")), device=device)
    _strict_load_state(flow, flow_state, 780, "FLUX.1 dev")
    del flow_state
    ae_state = load_file(str(_path_env("P316_MODEL_AE")), device=device)
    _strict_load_state(ae, ae_state, 244, "FLUX.1 AE")
    del ae_state
    gc.collect()

    MODELS = {"torch": torch, "device": device, "dtype": dtype, "t5": t5, "t5_tokenizer": t5_tokenizer, "clip": clip, "clip_tokenizer": clip_tokenizer, "flow": flow, "ae": ae}
    SESSION = {"loaded": True, "loadMs": (time.perf_counter() - t0) * 1000, "identity": identity, "componentDigest": _component_digest(identity)}
    return SESSION


def _encode_prompt(prompt: str) -> dict[str, Any]:
    torch = MODELS["torch"]
    device = MODELS["device"]
    with torch.no_grad():
        t5_inputs = MODELS["t5_tokenizer"]([prompt], padding="max_length", max_length=512, truncation=True, return_tensors="pt").to(device)
        # Match BFL HFEmbedder: FLUX was trained on the full padded sequence.
        # Masking padding changes every conditioning token and weakens adherence.
        txt = MODELS["t5"](input_ids=t5_inputs["input_ids"], attention_mask=None,
                           output_hidden_states=False).last_hidden_state
        clip_tokens = MODELS["clip_tokenizer"]([prompt]).to(device)
        clip_out = MODELS["clip"](input_ids=clip_tokens)
        vec = clip_out.pooler_output
    return {"txt": txt, "vec": vec}


def _generate(req: dict[str, Any]) -> dict[str, Any]:
    t0 = time.perf_counter()
    resident_before_job = SESSION is not None
    session = _load_session()
    torch = MODELS["torch"]
    device = MODELS["device"]
    from flux.sampling import denoise, get_noise, get_schedule, prepare, unpack

    encode_t = time.perf_counter()
    cond = _encode_prompt(req["prompt"])
    encode_ms = (time.perf_counter() - encode_t) * 1000
    infer_t = time.perf_counter()
    with torch.no_grad():
        noise = get_noise(1, HEIGHT, WIDTH, device=device, dtype=MODELS["dtype"], seed=req["seed"])
        inp = prepare(t5=lambda _prompts: cond["txt"], clip=lambda _prompts: cond["vec"], img=noise, prompt=[req["prompt"]])
        timesteps = get_schedule(STEPS, inp["img"].shape[1], shift=True)
        x = denoise(MODELS["flow"], **inp, timesteps=timesteps, guidance=GUIDANCE)
        x = unpack(x.float(), HEIGHT, WIDTH)
    inference_ms = (time.perf_counter() - infer_t) * 1000
    decode_t = time.perf_counter()
    with torch.no_grad():
        x = MODELS["ae"].decode(x)
        x = x.clamp(-1, 1).add(1).mul(127.5).byte().permute(0, 2, 3, 1).cpu().numpy()[0]
    from PIL import Image
    tmp = req["out"].with_suffix(".tmp.png")
    Image.fromarray(x, mode="RGB").save(tmp)
    os.replace(tmp, req["out"])
    decode_ms = (time.perf_counter() - decode_t) * 1000
    total_ms = (time.perf_counter() - t0) * 1000
    return {
        "ok": True,
        "engine": "flux",
        "model": "flux-dev",
        "seed": req["seed"],
        "loaded": True,
        "workerIdentity": session["identity"],
        "componentDigest": session["componentDigest"],
        "telemetry": {"modelLoadMs": 0 if resident_before_job else session["loadMs"], "loadMs": 0 if resident_before_job else session["loadMs"], "encodeMs": encode_ms, "inferenceMs": inference_ms, "decodeMs": decode_ms, "totalMs": total_ms, "peakVramBytes": _cuda_memory(), "maxCudaMemoryBytes": _cuda_memory(), "peakSystemRamBytes": _rss_bytes(), "processRamBytes": _rss_bytes(), "residentBeforeJob": resident_before_job, "residentAfterJob": True},
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
        # stderr keeps tracebacks out of the JSONL protocol while still leaving a
        # bounded app-profile log for package UAT.
        traceback.print_exc(file=sys.stderr)
        failed_id = None
        try:
            failed_id = json.loads(line).get("id")
        except Exception:
            failed_id = None
        _err(failed_id, exc.__class__.__name__, str(exc))
