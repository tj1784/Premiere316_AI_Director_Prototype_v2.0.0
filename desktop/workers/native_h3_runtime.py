"""Render actual native H3 motion from local weights, with sequential model residency."""
import os
for key in ('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'HF_TOKEN', 'OPENAI_API_KEY', 'XAI_API_KEY', 'ANTHROPIC_API_KEY'):
    os.environ.pop(key, None)
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
import gc
import json
import sys
import time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from native_h3_weights import make_model, converted_tensors, metadata_buffer
import torch
from safetensors import safe_open
from accelerate.utils import set_module_tensor_to_device
from accelerate import dispatch_model
from diffusers import MiniMaxH3ModularPipeline, MiniMaxH3Blocks, MiniMaxH3Scheduler
from diffusers.modular_pipelines.modular_pipeline import SequentialPipelineBlocks
from transformers import Qwen2TokenizerFast, Qwen3VLProcessor

ROOT = Path(__file__).resolve().parent / 'minimax_h3_config'
FILES = {
    'transformer': Path('D:/AI/Models/diffusion_models/MiniMax-H3/minimax_h3_fl2va_bf16.safetensors'),
    'text_encoder': Path('D:/AI/Models/text_encoders/MiniMax-H3/qwen3vl_32b_minimax_h3_bf16.safetensors'),
    'vae': Path('D:/AI/Models/vae/MiniMax-H3/minimax_h3_video_vae_fp16.safetensors'),
    'audio_vae': Path('D:/AI/Models/vae/MiniMax-H3/minimax_h3_audio_vae_fp32.safetensors'),
}
torch.set_grad_enabled(False)

def log(message):
    print(f'{time.strftime("%H:%M:%S")} {message}', flush=True)

def release():
    gc.collect()
    torch.cuda.empty_cache()

def load_role(role, offload_adaln=False):
    log('Loading ' + role)
    model = make_model(role, ROOT)
    expected = {key: tuple(value.shape) for key, value in model.state_dict().items()}
    loaded = set()
    with safe_open(str(FILES[role]), framework='pt', device='cpu') as checkpoint:
        if role == 'text_encoder':
            marker = json.loads(checkpoint.metadata().get('minimax_h3_te', '{}'))
            if marker != {'num_hidden_layers': 50, 'output': 'unnormalized_hidden_after_layer_50'}:
                raise ValueError('Unsupported truncated Qwen conditioning checkpoint')
        for index, source in enumerate(checkpoint.keys()):
            tensor = checkpoint.get_tensor(source)
            if metadata_buffer(role, source):
                if source == 'decoder.mask_token':
                    if torch.count_nonzero(tensor):
                        raise ValueError('Nonzero unsupported decoder mask token')
                elif source in ('latents_mean', 'latents_std'):
                    configured = torch.tensor(getattr(model.config, source))
                    if not torch.equal(tensor.flatten(), configured.to(tensor.dtype).flatten()):
                        raise ValueError('Latent normalization differs from native config')
                elif source == 'rope.inv_freq':
                    if not torch.allclose(tensor.float(), model.rope.inv_freq.float(), atol=1e-6):
                        raise ValueError('Rotary frequency mismatch')
                continue
            for key, value in converted_tensors(role, source, tensor):
                if key not in expected or tuple(value.shape) != expected[key] or key in loaded:
                    raise ValueError(f'Unmatched tensor {role}/{source} -> {key}')
                device = 'cpu' if offload_adaln and '.adaln_proj.' in key else 'cuda'
                set_module_tensor_to_device(model, key, device, value=value, dtype=value.dtype)
                loaded.add(key)
            if index % 150 == 0:
                log(f'{role}: {index}/{len(checkpoint.keys())} tensors')
        del tensor, value
    if loaded != set(expected):
        raise ValueError(f'Unloaded {role} tensors: {sorted(set(expected)-loaded)[:10]}')
    for name, buffer in model.named_buffers():
        if buffer.is_meta:
            raise ValueError(f'Uninitialized buffer: {name}')
        if buffer.device.type != 'cuda':
            set_module_tensor_to_device(model, name, 'cuda', value=buffer)
    if offload_adaln:
        device_map = {'': 'cuda', **{f'transformer_blocks.{i}.adaln_proj': 'cpu' for i in range(50)}}
        model = dispatch_model(model, device_map=device_map, main_device='cuda', force_hooks=True)
    log(f'{role} loaded; allocated {torch.cuda.memory_allocated()/1024**3:.1f} GiB')
    return model

