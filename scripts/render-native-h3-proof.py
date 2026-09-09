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
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'desktop/workers'))
from native_h3_weights import make_model, converted_tensors, metadata_buffer
import torch
from safetensors import safe_open
from accelerate.utils import set_module_tensor_to_device
from accelerate import dispatch_model
from diffusers import MiniMaxH3ModularPipeline, MiniMaxH3Blocks, MiniMaxH3Scheduler
from diffusers.modular_pipelines.modular_pipeline import SequentialPipelineBlocks
from transformers import Qwen2TokenizerFast, Qwen3VLProcessor

ROOT = Path('D:/Projects/MinimaxH3/vendor/MiniMax-H3')
FILES = {
    'transformer': Path('D:/AI/Models/diffusion_models/MiniMax-H3/minimax_h3_fl2va_bf16.safetensors'),
    'text_encoder': Path('D:/AI/Models/text_encoders/MiniMax-H3/qwen3vl_32b_minimax_h3_bf16.safetensors'),
    'vae': Path('D:/AI/Models/vae/MiniMax-H3/minimax_h3_video_vae_fp16.safetensors'),
    'audio_vae': Path('D:/AI/Models/vae/MiniMax-H3/minimax_h3_audio_vae_fp32.safetensors'),
}
OUT = Path('screenshots/moses-restart')
OUT.mkdir(parents=True, exist_ok=True)
PROMPT = 'A cinematic biblical film set on an undeveloped sandy shore of the Red Sea at night. Moses, an elderly bearded Hebrew man wearing plain undyed linen robes and leather sandals, grips a wooden staff. Wind drives his robes as he faces the turbulent water. Refugee families in ancient earth-toned robes hurry past him toward the shoreline. The camera slowly tracks sideways at eye level. Moonlight on dark water, distant torchlight, realistic human movement, solemn atmosphere. Sound of wind and surf. No dialogue.'
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

if __name__ == '__main__':
    started = time.time()
    all_blocks = MiniMaxH3Blocks().get_workflow('t2va').sub_blocks
    if (OUT/'proof-latents.pt').exists():
        state = None
        saved_latents = torch.load(OUT/'proof-latents.pt', map_location='cuda', weights_only=True)
        log('Resuming decode from completed motion latents')
    else:
        tokenizer = Qwen2TokenizerFast.from_pretrained(str(ROOT / 'tokenizer'), local_files_only=True)
        processor = Qwen3VLProcessor.from_pretrained(str(ROOT / 'processor'), local_files_only=True)
        embedding_path = OUT / 'proof-prompt-embeds.pt'
        if embedding_path.exists():
            cached = torch.load(embedding_path, map_location='cuda', weights_only=True)
            if cached['prompt'] != PROMPT:
                raise ValueError('Cached prompt mismatch')
            embeds = cached['embeds']
            token_ids = cached['token_ids']
            log('Using saved real prompt encoding')
        else:
            encoder = load_role('text_encoder')
            token_ids = tokenizer(PROMPT, add_special_tokens=False)['input_ids']
            ids = torch.tensor([token_ids], device='cuda')
            with torch.no_grad():
                # The exported encoder stops at the 50th raw layer. Identity final norm
                # gives the same intermediate representation without a nonexistent tail.
                embeds = encoder.model(input_ids=ids, attention_mask=torch.ones_like(ids),
                                       mm_token_type_ids=torch.tensor(processor.create_mm_token_type_ids([token_ids]), device='cuda'),
                                       use_cache=False, output_hidden_states=False).last_hidden_state.detach()
            torch.save({'prompt': PROMPT, 'embeds': embeds.cpu(), 'token_ids': token_ids}, embedding_path)
            del encoder, ids
            release()
            log('Real prompt encoded; text model released')
        
        denoise_blocks = SequentialPipelineBlocks.from_blocks_dict({name: block for name, block in all_blocks.items() if name.startswith('denoise.')})
        pipe = MiniMaxH3ModularPipeline(blocks=denoise_blocks)
        transformer = load_role('transformer', offload_adaln=True)
        pipe.update_components(transformer=transformer,
                               scheduler=MiniMaxH3Scheduler.from_config(json.loads((ROOT/'scheduler/scheduler_config.json').read_text())),
                               audio_scheduler=MiniMaxH3Scheduler.from_config(json.loads((ROOT/'audio_scheduler/scheduler_config.json').read_text())))
        log('Denoising actual motion frames')
        state = pipe(prompt_embeds=embeds, text_token_tags=torch.ones(len(token_ids), dtype=torch.long),
                     height=448, width=768, num_frames=124, num_inference_steps=20,
                     generator=torch.Generator(device='cuda').manual_seed(3161401))
        torch.save({'latents': state.get('latents').cpu(), 'audio_latents': state.get('audio_latents').cpu()}, OUT/'proof-latents.pt')
        pipe.unload_components('transformer')
        del transformer, pipe, embeds
        release()
        log('Motion denoised; transformer released')
    
    decode_blocks = SequentialPipelineBlocks.from_blocks_dict({name: block for name, block in all_blocks.items() if name.startswith('decode.')})
    decoder = MiniMaxH3ModularPipeline(blocks=decode_blocks)
    decoder.update_components(vae=load_role('vae'), audio_vae=load_role('audio_vae'))
    decode_inputs = saved_latents if state is None else {}
    result = decoder(state=state, **decode_inputs, output_type='np', output=['videos', 'audio', 'sampling_rate'])
    import imageio.v2 as imageio
    import numpy as np
    import soundfile as sf
    import imageio_ffmpeg
    import subprocess
    frames = (np.asarray(result['videos'][0]) * 255).clip(0, 255).astype(np.uint8)
    imageio.mimwrite(OUT/'proof-silent.mp4', frames, fps=24, codec='libx264', quality=8, macro_block_size=1)
    sf.write(OUT/'proof-audio.wav', result['audio'][0].detach().cpu().float().numpy().T, result['sampling_rate'])
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-y', '-i', str(OUT/'proof-silent.mp4'), '-i', str(OUT/'proof-audio.wav'), '-c:v', 'copy', '-c:a', 'aac', '-shortest', str(OUT/'moses-motion-proof.mp4')], check=True)
    (OUT/'motion-proof.json').write_text(json.dumps({'prompt': PROMPT, 'frames': len(frames), 'fps': 24, 'runtimeSeconds': time.time()-started, 'native': True, 'video': str((OUT/'moses-motion-proof.mp4').resolve())}, indent=2))
    log('Motion proof saved: ' + str((OUT/'moses-motion-proof.mp4').resolve()))
