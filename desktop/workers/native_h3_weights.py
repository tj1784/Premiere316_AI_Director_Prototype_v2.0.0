"""Explicit local H3 checkpoint adaptation; callers must strictly validate all tensors."""
import re
import torch


def converted_tensors(role, key, tensor):
    if role == 'text_encoder':
        if key.startswith('model.'):
            key = 'model.language_model.' + key[6:]
        elif key.startswith('visual.'):
            key = 'model.' + key
        yield key, tensor
        return
    if role == 'transformer':
        renames = {'video_patch_proj': 'proj_in', 'audio_patch_proj': 'audio_proj_in',
                   'condition_proj': 'context_embedder', 'time_embedder.proj_in': 'time_embedder.linear_1',
                   'time_embedder.proj_out': 'time_embedder.linear_2',
                   'final_layer.adaln_proj.linear': 'norm_out.linear', 'final_layer.norm': 'norm_out.norm',
                   'final_layer.video_out': 'proj_out', 'final_layer.audio_out': 'audio_proj_out'}
        for source, target in renames.items():
            if key.startswith(source + '.'):
                key = target + key[len(source):]
                break
        key = re.sub(r'^blocks\.', 'transformer_blocks.', key)
        key = key.replace('token_refiner.blocks.', 'token_refiner.refiner_blocks.')
        key = key.replace('.attn.q_norm.', '.attn.norm_q.').replace('.attn.k_norm.', '.attn.norm_k.')
        key = key.replace('.attn.out_proj.', '.attn.to_out.0.')
        if '.attn.qkv_proj.' in key:
            for projection, value in zip(('to_q', 'to_k', 'to_v'), tensor.chunk(3, dim=0)):
                yield key.replace('qkv_proj', projection), value
            return
        if '.mlp.fc1.' in key:
            gate, value = tensor.chunk(2, dim=0)
            tensor = torch.cat((value, gate), dim=0)
            key = key.replace('.mlp.fc1.', '.ff.net.0.proj.')
        key = key.replace('.mlp.fc2.', '.ff.net.2.')
    if role == 'vae':
        key = re.sub(r'encoder.down\.(\d+)\.block\.(\d+)\.', r'encoder.down_blocks.\1.resnets.\2.', key)
        key = re.sub(r'encoder.down\.(\d+)\.downsample\.', r'encoder.down_blocks.\1.downsamplers.0.', key)
        key = key.replace('encoder.mid.block_1.', 'encoder.mid_block.resnets.0.').replace('encoder.mid.block_2.', 'encoder.mid_block.resnets.1.')
        key = key.replace('.nin_shortcut.', '.conv_shortcut.')
        key = key.replace('decoder.x_embedder.', 'decoder.proj_in.')
        if '.attn.to_qkv.' in key:
            # Original VAE groups Q/K/V inside each of its 32 heads.
            # A global three-way split scrambles attention across heads.
            grouped = tensor.reshape(32, 3, 64, *tensor.shape[1:])
            for i, projection in enumerate(('to_q', 'to_k', 'to_v')):
                value = grouped[:, i].reshape(32 * 64, *tensor.shape[1:])
                yield key.replace('to_qkv', projection), value
            return
        key = key.replace('.attn.to_out.', '.attn.to_out.0.')
        if '.ff.w1.' in key:
            gate, value = tensor.chunk(2, dim=0)
            tensor = torch.cat((value, gate), dim=0)
            key = key.replace('.ff.w1.', '.ff.net.0.proj.')
        key = key.replace('.ff.w2.', '.ff.net.2.')
    yield key, tensor


def metadata_buffer(role, key):
    return (role == 'transformer' and key == 'rope.inv_freq') or (role in ('vae', 'audio_vae') and key in ('latents_mean', 'latents_std')) or (role == 'vae' and key == 'decoder.mask_token')


def make_model(role, config_root):
    import json
    from diffusers import MiniMaxH3Transformer3DModel, AutoencoderKLMiniMaxH3, AutoencoderKLMiniMaxH3Audio
    from transformers import Qwen3VLConfig, Qwen3VLForConditionalGeneration
    from accelerate import init_empty_weights
    config = json.loads((config_root / role / 'config.json').read_text())
    with init_empty_weights(include_buffers=False):
        if role == 'text_encoder':
            # This local file explicitly stores only the first 50 raw hidden layers.
            # Replacing the final norm with Identity preserves the raw conditioning.
            config['text_config']['num_hidden_layers'] = 50
            model = Qwen3VLForConditionalGeneration(Qwen3VLConfig.from_dict(config))
            model.model.language_model.norm = torch.nn.Identity()
            model.lm_head = torch.nn.Identity()
        else:
            cls = {'transformer': MiniMaxH3Transformer3DModel, 'vae': AutoencoderKLMiniMaxH3, 'audio_vae': AutoencoderKLMiniMaxH3Audio}[role]
            model = cls.from_config(config)
            if role == 'audio_vae':
                # The local export has already folded weight normalization.
                for module in model.modules():
                    if hasattr(module, 'weight_g') and hasattr(module, 'weight_v'):
                        torch.nn.utils.remove_weight_norm(module)
    return model.eval()


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

