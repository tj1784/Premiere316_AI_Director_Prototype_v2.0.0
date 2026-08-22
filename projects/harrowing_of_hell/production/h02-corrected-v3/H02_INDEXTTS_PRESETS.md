# H02 IndexTTS presets

Load in http://127.0.0.1:7860 → **从预设加载**.
After load: set **Language = EN**, set **时长系数** to the duration value below, leave **情感随机采样** off.

| Preset | Duration | Emo weight | Method | Vector (happy,angry,sad,afraid,disgust,melancholy,surprise,calm) |
|---|---:|---:|---|---|
| `H02_TORTURER_LOCK` | 1.10 | 0.54 | 0 same-as-voice | 0.00, 0.08, 0.02, 0.06, 0.12, 0.04, 0.00, 0.48 |
| `H02_ADAM_LOCK` | 1.12 | 0.58 | 0 same-as-voice | 0.00, 0.00, 0.16, 0.06, 0.00, 0.22, 0.00, 0.36 |
| `H02_EVE_LOCK` | 1.08 | 0.62 | 0 same-as-voice | 0.02, 0.00, 0.18, 0.04, 0.00, 0.12, 0.00, 0.42 |
| `H02_MOSES_LOCK` | 1.08 | 0.52 | 0 same-as-voice | 0.00, 0.04, 0.06, 0.00, 0.00, 0.08, 0.00, 0.55 |
| `H02_DAVID_LOCK` | 1.12 | 0.56 | 0 same-as-voice | 0.02, 0.00, 0.10, 0.04, 0.00, 0.18, 0.00, 0.42 |
| `H02_JOHN_LOCK` | 1.10 | 0.50 | 0 same-as-voice | 0.00, 0.00, 0.06, 0.04, 0.00, 0.08, 0.12, 0.50 |

## Advanced sampling (all presets)

```json
{
  "do_sample": false,
  "top_p": 0.8,
  "top_k": 30,
  "temperature": 0.8,
  "length_penalty": 0.0,
  "num_beams": 3,
  "repetition_penalty": 10.0,
  "max_mel_tokens": 1500,
  "max_text_tokens_per_segment": 120
}
```

## Emotion text (paste if you enable experimental / QwenEmotion)

**H02_TORTURER_LOCK:** Low dry judicial baritone. Controlled false mercy. No growl, no shout, no trailer cadence.

**H02_ADAM_LOCK:** Elderly weathered baritone. Confession before courage. Exhausted, intelligible, never a victory speech.

**H02_EVE_LOCK:** Mature contralto. Intimate, wounded, then morally clear. No scream, no sob through consonants.

**H02_MOSES_LOCK:** Older grounded baritone. Chained witness. Quiet accusation. No sermon cadence.

**H02_DAVID_LOCK:** Warm lyrical baritone. Narrow psalmic cantillation between speech and restrained chant. No Broadway vibrato.

**H02_JOHN_LOCK:** Rugged spare baritone. Be still is nearly breath. Recognition adds certainty, not volume.
