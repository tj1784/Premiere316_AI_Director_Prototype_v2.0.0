"""Resumable native H3 rendering of eighteen genuine ten-second shots."""
import importlib.util
import json
import time
import hashlib
import subprocess
from pathlib import Path

spec = importlib.util.spec_from_file_location('h3_local', Path(__file__).with_name('render-native-h3-proof.py'))
h3 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h3)
torch = h3.torch
ROOT = h3.ROOT
OUT = Path('screenshots/moses-restart/film')
OUT.mkdir(parents=True, exist_ok=True)
sequence = json.loads(Path(__file__).with_name('moses-film-sequence.json').read_text(encoding='utf-8'))
assert sum(s['seconds'] for s in sequence['shots']) == sequence['durationSeconds'] == 180
status_path = OUT / 'status.json'


def update(stage, **extra):
    data = {'title': sequence['title'], 'stage': stage, 'updatedAt': time.strftime('%Y-%m-%dT%H:%M:%S'),
            'targetSeconds': 180, 'totalShots': 18,
            'denoisedShots': len(list(OUT.glob('shot-*-latents.pt'))),
            'playableShots': len(list(OUT.glob('shot-*.mp4'))), **extra}
    pending = status_path.with_suffix('.tmp')
    pending.write_text(json.dumps(data, indent=2), encoding='utf-8')
    pending.replace(status_path)
    h3.log(f'{stage}: {extra}')


class ExactModulationCache(torch.nn.Module):
    """Reuse identical deterministic timestep projections across film shots."""
    def __init__(self, original):
        super().__init__()
        self.original = original
        self.cache = {}

    def forward(self, temb):
        raw = temb.detach().contiguous().cpu()
        key = (str(raw.dtype), tuple(raw.shape), raw.view(torch.uint8).numpy().tobytes())
        if key not in self.cache:
            self.cache[key] = tuple(value.detach().cpu() for value in self.original(temb))
        return tuple(value.to(temb.device) for value in self.cache[key])


def shot_prompt(shot):
    return sequence['visualContinuity'] + '\n' + shot['prompt']


def identity(shot):
    return hashlib.sha256(shot_prompt(shot).encode()).hexdigest()


def encode_all():
    missing = [s for s in sequence['shots'] if not (OUT / f"shot-{s['id']}-embeds.pt").exists()]
    if not missing:
        return
    update('loading_text_encoder')
    tokenizer = h3.Qwen2TokenizerFast.from_pretrained(str(ROOT/'tokenizer'), local_files_only=True)
    processor = h3.Qwen3VLProcessor.from_pretrained(str(ROOT/'processor'), local_files_only=True)
    encoder = h3.load_role('text_encoder')
    for shot in missing:
        update('encoding_prompt', shot=shot['id'])
        tokens = tokenizer(shot_prompt(shot), add_special_tokens=False)['input_ids']
        ids = torch.tensor([tokens], device='cuda')
        embeds = encoder.model(input_ids=ids, attention_mask=torch.ones_like(ids),
                               mm_token_type_ids=torch.tensor(processor.create_mm_token_type_ids([tokens]), device='cuda'),
                               use_cache=False, output_hidden_states=False).last_hidden_state.detach()
        torch.save({'hash': identity(shot), 'embeds': embeds.cpu(), 'token_ids': tokens}, OUT/f"shot-{shot['id']}-embeds.pt")
        del embeds, ids
    del encoder, processor, tokenizer
    h3.release()


def render_all():
    missing = [s for s in sequence['shots'] if not (OUT/f"shot-{s['id']}-latents.pt").exists()]
    if not missing:
        return
    update('loading_video_transformer')
    transformer = h3.load_role('transformer', offload_adaln=True)
    for block in transformer.transformer_blocks:
        block.adaln_proj = ExactModulationCache(block.adaln_proj)
    all_blocks = h3.MiniMaxH3Blocks().get_workflow('t2va').sub_blocks
    blocks = h3.SequentialPipelineBlocks.from_blocks_dict({name: block for name, block in all_blocks.items() if name.startswith('denoise.')})
    pipe = h3.MiniMaxH3ModularPipeline(blocks=blocks)
    pipe.update_components(transformer=transformer,
                           scheduler=h3.MiniMaxH3Scheduler.from_config(json.loads((ROOT/'scheduler/scheduler_config.json').read_text())),
                           audio_scheduler=h3.MiniMaxH3Scheduler.from_config(json.loads((ROOT/'audio_scheduler/scheduler_config.json').read_text())))
    for shot in missing:
        cache = torch.load(OUT/f"shot-{shot['id']}-embeds.pt", map_location='cuda', weights_only=True)
        if cache['hash'] != identity(shot):
            raise ValueError('Changed prompt: create a new shot revision before resuming')
        update('generating_motion', shot=shot['id'])
        started = time.time()
        state = pipe(prompt_embeds=cache['embeds'], text_token_tags=torch.ones(len(cache['token_ids']), dtype=torch.long),
                     height=448, width=768, num_frames=243, num_inference_steps=20,
                     generator=torch.Generator(device='cuda').manual_seed(3161400 + int(shot['id'])))
        torch.save({'hash': identity(shot), 'latents': state.get('latents').cpu(), 'audio_latents': state.get('audio_latents').cpu()}, OUT/f"shot-{shot['id']}-latents.pt")
        update('shot_motion_saved', shot=shot['id'], shotRenderSeconds=round(time.time()-started, 1))
        del state, cache
        h3.release()
    pipe.unload_components('transformer')
    del transformer, pipe
    h3.release()


def decode_all():
    import imageio.v2 as imageio
    import imageio_ffmpeg
    import soundfile as sf
    import numpy as np
    update('loading_decoders')
    all_blocks = h3.MiniMaxH3Blocks().get_workflow('t2va').sub_blocks
    blocks = h3.SequentialPipelineBlocks.from_blocks_dict({name: block for name, block in all_blocks.items() if name.startswith('decode.')})
    decoder = h3.MiniMaxH3ModularPipeline(blocks=blocks)
    decoder.update_components(vae=h3.load_role('vae'), audio_vae=h3.load_role('audio_vae'))
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    for shot in sequence['shots']:
        final = OUT/f"shot-{shot['id']}.mp4"
        if final.exists():
            continue
        update('converting_motion_to_video', shot=shot['id'])
        latents = torch.load(OUT/f"shot-{shot['id']}-latents.pt", map_location='cuda', weights_only=True)
        if latents.pop('hash') != identity(shot):
            raise ValueError('Saved motion does not match current prompt')
        result = decoder(**latents, output_type='np', output=['videos', 'audio', 'sampling_rate'])
        frames = (np.asarray(result['videos'][0])[:240] * 255).clip(0, 255).astype(np.uint8)
        if len(frames) != 240:
            raise ValueError('Incomplete ten-second shot')
        silent = OUT/f"shot-{shot['id']}-silent.mp4"
        wav = OUT/f"shot-{shot['id']}.wav"
        imageio.mimwrite(silent, frames, fps=24, codec='libx264', quality=8, macro_block_size=1)
        sf.write(wav, result['audio'][0].detach().cpu().float().numpy().T[:10*result['sampling_rate']], result['sampling_rate'])
        temporary = OUT/f"shot-{shot['id']}.partial.mp4"
        subprocess.run([ffmpeg, '-v', 'error', '-y', '-i', str(silent), '-i', str(wav), '-c:v', 'copy', '-c:a', 'aac', '-t', '10', '-movflags', '+faststart', str(temporary)], check=True)
        temporary.replace(final)
        imageio.imwrite(OUT/f"shot-{shot['id']}.jpg", frames[120])
        update('shot_playable', shot=shot['id'])
        del result, latents, frames
        h3.release()
    concat = OUT/'concat.txt'
    concat.write_text(''.join(f"file 'shot-{shot['id']}.mp4'\n" for shot in sequence['shots']))
    final = OUT/'Moses-The-Red-Sea-3min.mp4'
    update('assembling_movie')
    subprocess.run([ffmpeg, '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', str(concat), '-c:v', 'copy', '-c:a', 'aac', '-t', '180', '-movflags', '+faststart', str(final)], check=True)
    update('render_complete_pending_visual_review', video=str(final.resolve()))


if __name__ == '__main__':
    try:
        encode_all()
        render_all()
        decode_all()
    except Exception as error:
        update('failed', error=f'{type(error).__name__}: {error}')
        raise
