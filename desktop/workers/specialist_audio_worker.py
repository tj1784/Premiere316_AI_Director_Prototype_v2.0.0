"""One owned, offline specialist job. No text crew, voice fallback, approval, or download.

APIs verified against the official stable-audio-3 model.py and ACE-Step-1.5
inference.py interfaces. Live inference still requires those installed runtimes.
"""
import hashlib
import json
import os
from pathlib import Path
import socket
import sys

os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1")


def no_network(*args, **kwargs):
    raise RuntimeError("This worker is offline. Install required artifacts separately; downloads are not authorized.")


socket.socket.connect = no_network
socket.create_connection = no_network


def file_evidence(path):
    path = Path(path).resolve(strict=True)
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return {"path": str(path), "sha256": digest.hexdigest(), "bytes": path.stat().st_size}


def run(request):
    engine = request["engineId"]
    duration = float(request["duration"])
    if not 0 < duration <= 120:
        raise ValueError("Invalid cue duration")
    output = Path(request["outputDir"]).resolve(strict=True)
    runtime = Path(request["runtimeRoot"]).resolve(strict=True)
    sys.path.insert(0, str(runtime))
    import torch
    import soundfile as sf
    if not torch.cuda.is_available():
        raise RuntimeError("This configured specialist adapter requires CUDA; it will not silently switch device.")
    prompt = request["prompt"]
    seed = int(request["seed"])
    provenance = {"engineId": engine, "offline": True, "textCrewLoaded": False, "seed": seed}
    if engine == "stable-audio-3-small-sfx":
        from stable_audio_3 import StableAudioModel
        from stable_audio_3.model_configs import all_models
        selected = all_models["small-sfx"]
        if selected.repo_id != "stabilityai/stable-audio-3-small-sfx":
            raise RuntimeError("Installed runtime maps Small-SFX to a different repository.")
        config_path, checkpoint_path = selected.resolve()
        provenance["artifacts"] = [file_evidence(config_path), file_evidence(checkpoint_path)]
        model = StableAudioModel.from_pretrained("small-sfx", device="cuda")
        audio = model.generate(prompt=prompt, duration=duration, steps=8, cfg_scale=1.0,
                               seed=seed, batch_size=1)
        if audio.ndim != 3 or audio.shape[0] != 1:
            raise RuntimeError("Unexpected Stable Audio output shape")
        destination = output / "small-sfx.wav"
        sf.write(str(destination), audio[0].detach().float().cpu().T.numpy(), model.model.sample_rate, subtype="PCM_24")
    elif engine == "ace-step-1.5-xl-sft":
        os.environ["ACESTEP_CHECKPOINTS_DIR"] = str(runtime / "checkpoints")
        model_dir = runtime / "checkpoints" / "acestep-v15-xl-sft"
        config_path = model_dir / "config.json"
        weights = list(model_dir.glob("*.safetensors"))
        if not config_path.is_file() or not weights:
            raise RuntimeError("Exact checkpoints/acestep-v15-xl-sft config and weights are missing. Turbo is not a substitute.")
        provenance["artifacts"] = [file_evidence(config_path)] + [file_evidence(p) for p in sorted(weights)]
        from acestep.handler import AceStepHandler
        from acestep.inference import GenerationParams, GenerationConfig, generate_music
        handler = AceStepHandler()
        message, success = handler.initialize_service(project_root=str(runtime), config_path="acestep-v15-xl-sft", device="cuda")
        if not success:
            raise RuntimeError(str(message))
        params = GenerationParams(caption=prompt, lyrics="", duration=duration, seed=seed,
                                  inference_steps=50, guidance_scale=7.0, thinking=False,
                                  use_cot_caption=False, use_cot_language=False, use_cot_metas=False,
                                  reference_audio=request.get("referenceAudio"))
        if request.get("referenceAudio"):
            provenance["musicalReference"] = file_evidence(request["referenceAudio"])
        config = GenerationConfig(batch_size=1, audio_format="wav", allow_lm_batch=False,
                                  use_random_seed=False, seeds=[seed])
        result = generate_music(handler, None, params, config, save_dir=str(output))
        if not result.success or len(result.audios) != 1:
            raise RuntimeError(result.error or "ACE-Step returned no single valid output")
        destination = Path(result.audios[0]["path"]).resolve(strict=True)
        if output not in destination.parents:
            raise RuntimeError("ACE-Step output escaped its job directory")
    else:
        raise ValueError("Unsupported specialist variant")
    return {"engineId": engine, "path": str(destination), "provenance": provenance}


if __name__ == "__main__":
    try:
        request = json.loads(sys.stdin.read())
        result = run(request)
        print("P316_AUDIO_RESULT " + json.dumps(result), flush=True)
    except Exception as error:
        print(f"{type(error).__name__}: {error}", file=sys.stderr, flush=True)
        sys.exit(1)
