#!/usr/bin/env python3
"""Multi-character Qwen3-TTS Base dialogue Gradio."""
from __future__ import annotations

import argparse
import os
import re
import tempfile
from pathlib import Path

import gradio as gr
import numpy as np
import soundfile as sf
import torch

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

REPO = Path(__file__).resolve().parents[1]
PROJECT = REPO / "projects" / "harrowing_of_hell"
LINE_RE = re.compile(r"^\s*(?:\[(?P<b>[^\]]+)\]|(?P<a>[A-Za-z][A-Za-z0-9 _/-]*))\s*[:\-—]\s*(?P<text>.+?)\s*$")

DEFAULT_CAST = [
    {
        "name": "TORTURER",
        "wav": PROJECT / "production/h02-corrected-v3/provided-voice-refs/torturer_ref_12s.wav",
        "transcript": "I do not shout, I do not beg the dark to make me larger. I weigh a man the way a court weighs dust, slowly and without pity. You were formed from the ground, and the ground has not forgotten you.",
    },
    {
        "name": "ADAM",
        "wav": PROJECT / "production/h02-corrected-v3/provided-voice-refs/adam_ref_12s.wav",
        "transcript": "I am worn, and I will not pretend I am clean. I hid when I should have stood, I named her when I should have named my own fear.",
    },
    {
        "name": "EVE",
        "wav": PROJECT / "production/h02-corrected-v3/provided-voice-refs/eve_ref_12s.wav",
        "transcript": "Adam, look at me. I will not let this darkness make strangers of us again. I chose the serpent's lie with my own will, and the wound is mine.",
    },
    {
        "name": "MOSES",
        "wav": PROJECT / "production/h02-corrected-v3/provided-voice-refs/moses_ref_12s.wav",
        "transcript": "Hold fast, Adam. These chains may close upon the hand, but they cannot close upon the promise. You claim no innocence. You ask no wage.",
    },
    {
        "name": "DAVID",
        "wav": PROJECT / "production/h02-corrected-v3/provided-voice-refs/david_ref_12s.wav",
        "transcript": "I will not answer him with my own name. I will answer with the song that was given me. You will not abandon my soul to Sheol, even in the depths I will wait for you. You will not let your Holy One see corruption.",
    },
    {
        "name": "JOHN",
        "wav": PROJECT / "production/h02-corrected-v3/provided-voice-refs/john_ref_12s.wav",
        "transcript": "Be still. Do not fill this silence with fear. I know that tread. I heard it beside the Jordan.",
    },
]

DEFAULT_SCRIPT = """TORTURER: Renounce the promise, and this ends.
ADAM: The promise is not mine to renounce.
TORTURER: You are dust. Dust has no inheritance.
ADAM: I am dust—and still I belong to God.
TORTURER: Look upon the inheritance of rebellion.
EVE: Adam—look at me.
MOSES: Hold fast, Adam. You are not alone.
MOSES: He claims no innocence. He waits for God’s mercy.
TORTURER: Your Messiah is dead.
MOSES: You seized the faithful because His death frightened you.
TORTURER: Then let Him come. Adam is my pledge.
TORTURER: You blamed her once. Will you condemn her again?
EVE: No. I chose the lie; I will not choose yours.
TORTURER: In the garden, you offered her instead of yourself.
ADAM: I named her when I should have confessed. Never again.
ADAM: He found us hiding, and covered our shame.
ADAM: Then He promised the woman’s Son would crush the serpent.
TORTURER: Sons beyond counting have crossed these gates.
TORTURER: So where is the Son you were promised?
DAVID: You will not abandon my soul to Sheol.
DAVID: Nor let Your Holy One see corruption.
JOHN: Be still.
JOHN: I know that tread. I heard it at the Jordan.
JOHN: Death has taken the One it cannot hold.
"""


def parse_script(script: str):
    lines = []
    for raw in (script or "").splitlines():
        if not raw.strip() or raw.strip().startswith("#"):
            continue
        match = LINE_RE.match(raw)
        if not match:
            raise ValueError(f"Bad line (use SPEAKER: text): {raw}")
        speaker = (match.group("a") or match.group("b") or "").strip().upper().replace(" ", "_")
        text = match.group("text").strip()
        if not text:
            raise ValueError(f"Empty spoken text for {speaker}")
        lines.append((speaker, text))
    if not lines:
        raise ValueError("Script is empty. Use one line per speech: SPEAKER: dialogue")
    return lines


def audio_path(value):
    if value is None:
        return None
    if isinstance(value, str) and Path(value).is_file():
        return value
    if isinstance(value, dict):
        for key in ("path", "name"):
            if value.get(key) and Path(value[key]).is_file():
                return value[key]
    if isinstance(value, (list, tuple)) and value and Path(str(value[0])).is_file():
        return str(value[0])
    return None


def concat_wavs(pieces, sr, gap_sec):
    gap = np.zeros(max(0, int(sr * float(gap_sec))), dtype=np.float32)
    out = []
    for i, wav in enumerate(pieces):
        mono = np.asarray(wav, dtype=np.float32)
        if mono.ndim > 1:
            mono = mono.mean(axis=-1)
        out.append(mono)
        if i < len(pieces) - 1 and gap.size:
            out.append(gap)
    return np.concatenate(out) if out else np.zeros(1, dtype=np.float32)


def build_app(model, languages):
    default_names = [c["name"] for c in DEFAULT_CAST]
    default_wavs = [str(c["wav"]) if c["wav"].is_file() else None for c in DEFAULT_CAST]
    default_refs = [c["transcript"] for c in DEFAULT_CAST]
    while len(default_names) < 6:
        default_names.append("")
        default_wavs.append(None)
        default_refs.append("")

    with gr.Blocks(title="Qwen3-TTS Multi-Character Dialogue") as demo:
        gr.Markdown(
            "# Qwen3-TTS · Multi-Character Dialogue\n"
            "One speaker per line. Format: `ADAM: I am dust—and still I belong to God.`\n"
            "Upload a reference WAV + exact transcript for each character, then generate the scene."
        )
        with gr.Row():
            language = gr.Dropdown(label="Language", choices=languages or ["English", "Auto"], value="English")
            gap = gr.Slider(0.05, 1.5, value=0.35, step=0.05, label="Gap between lines (sec)")
            xvec = gr.Checkbox(label="x-vector only (no ref transcript)", value=False)
        name_boxes, wav_boxes, ref_boxes = [], [], []
        with gr.Accordion("Character voices (up to 6)", open=True):
            for i in range(6):
                with gr.Row():
                    name_boxes.append(gr.Textbox(label=f"Speaker {i+1}", value=default_names[i], scale=1))
                    wav_boxes.append(gr.Audio(label="Reference WAV", type="filepath", value=default_wavs[i], scale=2))
                    ref_boxes.append(gr.Textbox(label="Reference transcript", value=default_refs[i], lines=2, scale=3))
        script = gr.Textbox(label="Dialogue script", value=DEFAULT_SCRIPT, lines=18)
        go = gr.Button("Generate scene", variant="primary")
        mix = gr.Audio(label="Full scene", type="numpy")
        status = gr.Textbox(label="Status", lines=8)
        files = gr.Files(label="Per-line WAVs + mix")

        def generate(script_text, lang, gap_sec, use_xvec, *cast_fields):
            names = [str(cast_fields[i] or "").strip().upper().replace(" ", "_") for i in range(0, 18, 3)]
            wavs = [cast_fields[i] for i in range(1, 18, 3)]
            refs = [str(cast_fields[i] or "").strip() for i in range(2, 18, 3)]
            roster = {}
            for name, wav, ref in zip(names, wavs, refs):
                path = audio_path(wav)
                if not name or not path:
                    continue
                roster[name] = {"wav": path, "ref": ref}
            try:
                lines = parse_script(script_text)
            except Exception as error:
                return None, str(error), None
            missing = sorted({spk for spk, _ in lines if spk not in roster})
            if missing:
                return None, f"No voice loaded for: {', '.join(missing)}", None
            work = Path(tempfile.mkdtemp(prefix="qwen_dialogue_"))
            pieces, paths, log = [], [], []
            sr_out = 24000
            for index, (speaker, text) in enumerate(lines, start=1):
                voice = roster[speaker]
                if (not use_xvec) and (not voice["ref"]):
                    return None, f"{speaker} needs a reference transcript (or enable x-vector only).", None
                log.append(f"{index:02d} {speaker}: {text}")
                try:
                    wavs_out, sr_out = model.generate_voice_clone(
                        text=text,
                        language=lang or "English",
                        ref_audio=voice["wav"],
                        ref_text=None if use_xvec else voice["ref"],
                        x_vector_only_mode=bool(use_xvec),
                    )
                except Exception as error:
                    return None, "\n".join(log + [f"FAILED on {speaker}: {type(error).__name__}: {error}"]), None
                wav = np.asarray(wavs_out[0], dtype=np.float32)
                dest = work / f"{index:02d}_{speaker.lower()}.wav"
                sf.write(dest, wav, int(sr_out))
                pieces.append(wav)
                paths.append(str(dest))
            mixed = concat_wavs(pieces, int(sr_out), gap_sec)
            mix_path = work / "00_scene_mix.wav"
            sf.write(mix_path, mixed, int(sr_out))
            return (int(sr_out), mixed), "Finished.\n" + "\n".join(log), [str(mix_path), *paths]

        go.click(
            generate,
            inputs=[script, language, gap, xvec, *[item for triple in zip(name_boxes, wav_boxes, ref_boxes) for item in triple]],
            outputs=[mix, status, files],
        )
    return demo


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--device", default="cuda:0")
    parser.add_argument("--ip", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8001)
    args = parser.parse_args()
    from qwen_tts import Qwen3TTSModel

    model = Qwen3TTSModel.from_pretrained(
        args.checkpoint,
        device_map=args.device,
        dtype=torch.bfloat16,
        attn_implementation="sdpa",
        local_files_only=True,
    )
    languages = ["English", "Auto"]
    getter = getattr(model.model, "get_supported_languages", None)
    if callable(getter):
        raw = [str(x) for x in (getter() or [])]
        if raw:
            languages = raw
    demo = build_app(model, languages)
    demo.queue().launch(server_name=args.ip, server_port=args.port, share=False, inbrowser=False)


if __name__ == "__main__":
    main()
