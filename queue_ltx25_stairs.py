import json, urllib.request, mimetypes, os, uuid

COMFY = "http://127.0.0.1:8188"
API = r"C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0\BlokeyUI\ComfyUI\user\default\workflows\Premiere316\03_DECENT_3s_PITLOCK_LTX.api.json"
STILL = r"C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0\projects\harrowing_of_hell\media\assets\loc-descent.v1.png"
PROMPT = (
    "Cinematic dark-fantasy, Harrowing of Hell look. Camera descends obsidian stone stairs "
    "into thick red volumetric haze, dying embers on the walls, smoke and ash, divine gold light "
    "fading as we drop. No new characters, no faces added. One continuous 9:16 shot."
)

def post_json(path, payload):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(COMFY + path, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))

def upload_image(path, subfolder="harrowing_shorts"):
    boundary = uuid.uuid4().hex
    filename = os.path.basename(path)
    with open(path, "rb") as f:
        raw = f.read()
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="image"; filename="{filename}"\r\n'
        "Content-Type: image/png\r\n\r\n"
    ).encode() + raw + (
        f"\r\n--{boundary}\r\n"
        'Content-Disposition: form-data; name="subfolder"\r\n\r\n'
        f"{subfolder}\r\n"
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="overwrite"\r\n\r\n'
        "true\r\n"
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="type"\r\n\r\n'
        "input\r\n"
        f"--{boundary}--\r\n"
    ).encode()
    req = urllib.request.Request(
        COMFY + "/upload/image",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        j = json.loads(r.read().decode("utf-8"))
    return f"{j['subfolder']}/{j['name']}" if j.get("subfolder") else j["name"]

comfy_file = upload_image(STILL)
print("uploaded", comfy_file)

prompt = json.load(open(API, encoding="utf-8"))

# LTX 2.5 distilled int8 stack
if "3" in prompt:
    prompt["3"]["class_type"] = "VAELoader"
    prompt["3"]["inputs"] = {"vae_name": r"LTX\2.5\ltx-2.5-video-vae-bf16.safetensors"}
if "4" in prompt:
    prompt["4"]["class_type"] = "VAELoader"
    prompt["4"]["inputs"] = {"vae_name": r"LTX\2.5\ltx-2.5-audio-vae-bf16.safetensors"}
if "84" in prompt:
    prompt["84"]["class_type"] = "CLIPLoader"
    prompt["84"]["inputs"] = {
        "clip_name": "gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors",
        "type": "ltxv",
        "device": "default",
    }
if "95" in prompt:
    prompt["95"]["inputs"]["unet_name"] = "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors"
    prompt["95"]["inputs"]["weight_dtype"] = "default"
# skip 2.3 loras — feed UNET straight into Director
if "46" in prompt and prompt["46"].get("class_type") == "LTXDirector":
    prompt["46"]["inputs"]["model"] = ["95", 0]
    prompt["46"]["inputs"]["clip"] = ["84", 0]
    prompt["46"]["inputs"]["start_second"] = 0
    prompt["46"]["inputs"]["end_second"] = 16
    prompt["46"]["inputs"]["duration_seconds"] = 16
    prompt["46"]["inputs"]["start_frame"] = 0
    prompt["46"]["inputs"]["end_frame"] = 385
    prompt["46"]["inputs"]["duration_frames"] = 385
    prompt["46"]["inputs"]["frame_rate"] = 24
    prompt["46"]["inputs"]["custom_width"] = 704
    prompt["46"]["inputs"]["custom_height"] = 1280
    prompt["46"]["inputs"]["local_prompts"] = PROMPT
    prompt["46"]["inputs"]["segment_lengths"] = "385"
    prompt["46"]["inputs"]["guide_strength"] = "1.00"
    td = prompt["46"]["inputs"].get("timeline_data")
    if isinstance(td, str):
        try:
            data = json.loads(td)
        except Exception:
            data = {}
        data["global_prompt"] = PROMPT
        data["normalDurationFrames"] = 385
        data["inpaint_audio"] = True
        segs = [{
            "id": "stairs-first",
            "start": 0,
            "length": 385,
            "prompt": PROMPT,
            "type": "image",
            "imageFile": comfy_file,
            "isEndFrame": False,
            "label": "0–16s",
        }]
        data["segments"] = segs
        prompt["46"]["inputs"]["timeline_data"] = json.dumps(data)
if "57" in prompt:
    prompt["57"]["inputs"]["model_name"] = r"LTX\2.5\ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors"
if "94" in prompt:
    prompt["94"]["inputs"]["filename_prefix"] = "harrowing_shorts/stairs_red_haze_ltx25"
    prompt["94"]["inputs"]["frame_rate"] = 24

# drop unused 2.3 lora nodes if present
for nid in ("100", "101"):
    prompt.pop(nid, None)

body = {"prompt": prompt, "client_id": "randall-shorts-ltx25"}
req = urllib.request.Request(
    COMFY + "/prompt",
    data=json.dumps(body).encode("utf-8"),
    headers={"Content-Type": "application/json"},
)
try:
    with urllib.request.urlopen(req, timeout=60) as r:
        out = r.read().decode("utf-8")
        print("status", r.status)
        print(out[:2500])
except urllib.error.HTTPError as e:
    print("status", e.code)
    print(e.read().decode("utf-8", errors="replace")[:4000])
