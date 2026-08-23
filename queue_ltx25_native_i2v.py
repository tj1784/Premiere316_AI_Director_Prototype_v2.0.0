import json, urllib.request, time, os, uuid

COMFY = "http://127.0.0.1:8188"
IMAGE = "harrowing_shorts/loc-descent.v1.png"
PROMPT = (
    "Cinematic dark-fantasy, Harrowing of Hell look. Camera descends obsidian stone stairs "
    "into thick red volumetric haze, dying embers, smoke and ash, gold light fading. "
    "No people, no new faces. One continuous 9:16 shot."
)
NEG = "cartoon, anime, text, watermark, extra limbs, modern city"
W, H, LENGTH, FPS = 704, 1280, 121, 24  # 5s, 8n+1
LORA = r"LTX\2.5\ltx-2.5-22b-distilled-lora-450-bf16.safetensors"
DIT = "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors"

prompt = {
    "1": {"class_type": "LoadImage", "inputs": {"image": IMAGE}},
    "2": {"class_type": "LTX2_SM_VAE", "inputs": {"vae": r"LTX\2.5\ltx-2.5-video-vae-bf16.safetensors"}},
    "3": {"class_type": "CLIPLoader", "inputs": {
        "clip_name": "gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors",
        "type": "ltxv",
        "device": "default",
    }},
    "4": {"class_type": "LTX2_SM_Model", "inputs": {
        "dit": DIT,
        "gguf": "none",
        "distilled_lora": LORA,
        "lora": LORA,
        "sampling_mode": "distilled",
        "offload": True,
    }},
    "5": {"class_type": "CLIPTextEncode", "inputs": {"text": PROMPT, "clip": ["3", 0]}},
    "6": {"class_type": "CLIPTextEncode", "inputs": {"text": NEG, "clip": ["3", 0]}},
    "7": {"class_type": "LTXVConditioning", "inputs": {
        "positive": ["5", 0], "negative": ["6", 0], "frame_rate": float(FPS),
    }},
    "8": {"class_type": "LTXVImgToVideo", "inputs": {
        "positive": ["7", 0],
        "negative": ["7", 1],
        "vae": ["2", 0],
        "image": ["1", 0],
        "width": W,
        "height": H,
        "length": LENGTH,
        "batch_size": 1,
        "strength": 1.0,
    }},
    "9": {"class_type": "LTX2_SM_KSampler", "inputs": {
        "model": ["4", 0],
        "latents": ["8", 2],
        "steps": 8,
        "seed": 316016,
        "video_cfg_guidance_scale": 1.0,
        "video_stg_guidance_scale": 0.0,
        "video_rescale_scale": 0.0,
        "a2v_guidance_scale": 1.0,
        "video_skip_step": 0,
        "video_stg_blocks": -1,
        "audio_cfg_guidance_scale": 1.0,
        "audio_stg_guidance_scale": 0.0,
        "audio_rescale_scale": 0.0,
        "v2a_guidance_scale": 1.0,
        "audio_skip_step": 0,
        "audio_stg_blocks": -1,
        "block_group_size": 2,
        "spatial_upsampler": "none",
        "positive": ["8", 0],
        "negative": ["8", 1],
        "encoder": ["2", 1],
    }},
    "10": {"class_type": "VAEDecodeTiled", "inputs": {
        "samples": ["9", 0],
        "vae": ["2", 0],
        "tile_size": 512,
        "overlap": 64,
        "temporal_size": 64,
        "temporal_overlap": 8,
    }},
    "11": {"class_type": "CreateVideo", "inputs": {"images": ["10", 0], "fps": float(FPS)}},
    "12": {"class_type": "SaveVideo", "inputs": {
        "video": ["11", 0],
        "filename_prefix": "harrowing_shorts/stairs_red_haze",
        "format": "auto",
        "codec": "auto",
    }},
}

req = urllib.request.Request(
    COMFY + "/prompt",
    data=json.dumps({"prompt": prompt, "client_id": "randall-stairs"}).encode(),
    headers={"Content-Type": "application/json"},
)
try:
    with urllib.request.urlopen(req, timeout=60) as r:
        out = json.loads(r.read().decode())
        print("queued", out.get("prompt_id"), "number", out.get("number"), "errors", out.get("node_errors"))
        open(r"C:\Users\Blokey\Documents\harrowing_stairs_prompt_id.txt", "w").write(out.get("prompt_id", ""))
except urllib.error.HTTPError as e:
    print("status", e.code)
    print(e.read().decode("utf-8", "replace")[:4000])
