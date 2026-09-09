"""Inspect local checkpoint compatibility without loading tensor payloads."""
import json
import os
import struct
from pathlib import Path

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
ROOT = Path('D:/Projects/MinimaxH3/vendor/MiniMax-H3')
FILES = {
    'transformer': Path('D:/AI/Models/diffusion_models/MiniMax-H3/minimax_h3_fl2va_bf16.safetensors'),
    'text_encoder': Path('D:/AI/Models/text_encoders/MiniMax-H3/qwen3vl_32b_minimax_h3_bf16.safetensors'),
    'vae': Path('D:/AI/Models/vae/MiniMax-H3/minimax_h3_video_vae_fp16.safetensors'),
    'audio_vae': Path('D:/AI/Models/vae/MiniMax-H3/minimax_h3_audio_vae_fp32.safetensors'),
}

def header(path):
    with path.open('rb') as stream:
        size = struct.unpack('<Q', stream.read(8))[0]
        if size > 100_000_000 or size > path.stat().st_size - 8:
            raise ValueError('Invalid safetensors header length')
        return json.loads(stream.read(size))

if __name__ == '__main__':
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'desktop/workers'))
    from native_h3_weights import make_model, converted_tensors, metadata_buffer
    import torch
    from diffusers import MiniMaxH3Transformer3DModel, AutoencoderKLMiniMaxH3, AutoencoderKLMiniMaxH3Audio
    from transformers import Qwen3VLConfig, Qwen3VLForConditionalGeneration
    classes = {'transformer': MiniMaxH3Transformer3DModel, 'vae': AutoencoderKLMiniMaxH3, 'audio_vae': AutoencoderKLMiniMaxH3Audio}
    results = {}
    for role, path in FILES.items():
        checkpoint = header(path)
        metadata = checkpoint.pop('__metadata__', {})
        model = make_model(role, ROOT)
        adapted = {}
        for source, info in checkpoint.items():
            if metadata_buffer(role, source):
                continue
            tensor = torch.empty(info['shape'], device='meta')
            for key, value in converted_tensors(role, source, tensor):
                if key in adapted:
                    raise ValueError(f'Duplicate converted key: {key}')
                adapted[key] = {'shape': list(value.shape)}
        checkpoint = adapted
        expected = model.state_dict()
        layout_path = Path('screenshots/moses-restart') / f'{role}-layout.json'
        layout_path.parent.mkdir(parents=True, exist_ok=True)
        layout_path.write_text(json.dumps({'expected': {k: list(v.shape) for k, v in expected.items()}, 'actual': {k: v['shape'] for k, v in checkpoint.items()}}, indent=2))
        missing = sorted(set(expected) - set(checkpoint))
        extra = sorted(set(checkpoint) - set(expected))
        shapes = [key for key in set(expected) & set(checkpoint) if list(expected[key].shape) != checkpoint[key]['shape']]
        results[role] = {'bytes': path.stat().st_size, 'tensorCount': len(checkpoint), 'expectedCount': len(expected), 'missingCount': len(missing), 'extraCount': len(extra), 'shapeMismatchCount': len(shapes), 'missingSample': missing[:6], 'extraSample': extra[:6], 'shapeMismatchSample': shapes[:6], 'checkpointSample': list(checkpoint)[:6], 'metadata': metadata}
        print(json.dumps({role: results[role]}), flush=True)
        del model, expected
    output = Path('screenshots/moses-restart/native-h3-compatibility.json')
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(results, indent=2))
