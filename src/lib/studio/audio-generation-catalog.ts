export type AudioGenerationGroup = "songs" | "sound" | "speech";
export type AudioGenerationOption = {
  id: string;
  name: string;
  slot: "music" | "voice";
  group: AudioGenerationGroup;
  purpose: string;
  license: { label: string; detail: string; url: string };
  modelUrl: string;
  setupUrl: string;
  template: string;
  setupNotes: string[];
  files: string[];
};

export const TTS_AUDIO_SUITE_URL = "https://github.com/diodiogod/TTS-Audio-Suite";
export const AUDIO_CATALOG_VERIFIED_ON = "2026-09-14";

/** Setup references are catalog entries, not proof of installed or working runtimes. */
export const AUDIO_GENERATION_OPTIONS: readonly AudioGenerationOption[] = [
  {
    id: "minimax-music3", name: "MiniMax-Music3", slot: "music", group: "songs",
    purpose: "Complete songs with vocals from a caption and lyrics; up to 5 minutes, 32 kHz stereo.",
    license: {
      label: "Community · commercial terms",
      detail: "Commercial products must display MiniMax-Music3. Separate written authorization is required above $20M in aggregate yearly revenue from relevant products and services, including affiliates. Other license terms apply.",
      url: "https://huggingface.co/MiniMaxAI/MiniMax-Music3/blob/main/LICENSE",
    },
    modelUrl: "https://huggingface.co/Comfy-Org/MiniMax-Music-3",
    setupUrl: "https://docs.comfy.org/tutorials/audio/minimax/minimax-music-3",
    template: "MiniMax Music 3 Text to Music",
    setupNotes: [
      "Update ComfyUI and open Template Library → Audio → MiniMax Music 3 Text to Music.",
      "Use the FP16 diffusion model for the requested high-memory setup. INT8 is an optional smaller alternative; leave tiled decode off when VRAM permits.",
    ],
    files: ["models/diffusion_models/minimax_music3_dit_fp16.safetensors", "models/text_encoders/minimax_music3_text_encoder_pruned_int8_convrot.safetensors", "models/vae/minimax_music3_dav.safetensors"],
  },
  {
    id: "yue2", name: "YuE2-3B", slot: "music", group: "songs",
    purpose: "Vocal songs with editable melody and chords; 48 kHz stereo.",
    license: {
      label: "CC BY-NC 4.0 · non-commercial",
      detail: "Reserve for non-commercial projects. Keep YuE2 audio out of paid LMS, client work, and commercial apps; attribution is required by the model license.",
      url: "https://huggingface.co/m-a-p/YuE2-3B",
    },
    modelUrl: "https://huggingface.co/Comfy-Org/YuE2",
    setupUrl: "https://github.com/Comfy-Org/ComfyUI/pull/16250",
    template: "YuE2 native example workflow",
    setupNotes: ["Use ComfyUI with the native YuE2 support merged September 11, 2026. The setup link includes its example workflow.", "Use the Comfy-Org checkpoint pack for ComfyUI. The separate original VAE is at huggingface.co/m-a-p/YuE2-Vae."],
    files: ["models/checkpoints/yue2_3b_bf16.safetensors", "models/audio_encoders/sheetsage2_bf16.safetensors"],
  },
  {
    id: "ace-step-1.5", name: "ACE-Step 1.5", slot: "music", group: "songs",
    purpose: "Fast song drafts, style variations, and tempo exploration from tags and lyrics.",
    license: {
      label: "MIT",
      detail: "Commercial use permitted under MIT. Retain the required copyright and license notices when distributing the software or weights.",
      url: "https://huggingface.co/ACE-Step/Ace-Step1.5",
    },
    modelUrl: "https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files",
    setupUrl: "https://docs.comfy.org/tutorials/audio/ace-step/ace-step-v1-5",
    template: "ACE-Step 1.5 Music Generation AIO",
    setupNotes: ["Update ComfyUI and choose the AIO template; the combined checkpoint avoids installing a separate set of components.", "The model supports covers and repainting, but ComfyUI's official guide currently lists those workflow features as coming soon."],
    files: ["models/checkpoints/ace_step_1.5_turbo_aio.safetensors"],
  },
  {
    id: "stable-audio-3", name: "Stable Audio 3 Medium", slot: "music", group: "sound",
    purpose: "Instrumental beds, loops, Foley, ambience, and one-shots; up to about 6:20.",
    license: {
      label: "Stable Audio Community",
      detail: "Commercial use requires registration under the linked community license; above $1M annual revenue, request a separate license. Attribution and Gemma component terms also apply.",
      url: "https://huggingface.co/stabilityai/stable-audio-3-medium",
    },
    modelUrl: "https://huggingface.co/Comfy-Org/stable-audio-3",
    setupUrl: "https://docs.comfy.org/tutorials/audio/stable-audio/stable-audio-3",
    template: "Stable Audio 3.0 Medium",
    setupNotes: ["Choose Music, Instrument, SFX, or One-shot in the category control. Use a song model when lyrics and singing are needed.", "The Medium template includes Qwen prompt expansion and requires its additional text encoder. Download only the chosen variant."],
    files: ["models/checkpoints/stable_audio_3_medium.safetensors", "models/text_encoders/t5gemma_b_b_ul2.safetensors", "models/text_encoders/qwen3.5_2b_bf16.safetensors"],
  },
  {
    id: "qwen3-tts", name: "Qwen3-TTS 1.7B VoiceDesign", slot: "voice", group: "speech",
    purpose: "Describe a character's voice in words without supplying a reference recording.",
    license: {
      label: "Apache 2.0",
      detail: "Commercial use permitted under Apache 2.0; retain applicable license and attribution notices.",
      url: "https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign",
    },
    modelUrl: "https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign",
    setupUrl: TTS_AUDIO_SUITE_URL,
    template: "TTS-Audio-Suite · Qwen3-TTS Voice Design",
    setupNotes: ["Install the shared TTS-Audio-Suite pack once. Select the 1.7B VoiceDesign variant for description-based voice creation."],
    files: [],
  },
  {
    id: "qwen3-tts-base", name: "Qwen3-TTS 1.7B Base", slot: "voice", group: "speech",
    purpose: "Clone a voice from a short reference recording and use it for dialogue.",
    license: {
      label: "Apache 2.0",
      detail: "Commercial use permitted under Apache 2.0; retain applicable license and attribution notices.",
      url: "https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base",
    },
    modelUrl: "https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base",
    setupUrl: TTS_AUDIO_SUITE_URL,
    template: "TTS-Audio-Suite · Qwen3-TTS voice cloning",
    setupNotes: ["Use the same TTS-Audio-Suite pack and select the 1.7B Base variant. Supply a reference voice clip for cloning."],
    files: [],
  },
  {
    id: "voxcpm2", name: "VoxCPM2", slot: "voice", group: "speech",
    purpose: "Voice cloning with reference audio and optional delivery guidance; 48 kHz output.",
    license: {
      label: "Apache 2.0",
      detail: "Commercial use permitted under Apache 2.0; retain applicable license and attribution notices.",
      url: "https://huggingface.co/openbmb/VoxCPM2",
    },
    modelUrl: "https://huggingface.co/openbmb/VoxCPM2",
    setupUrl: "https://github.com/OpenBMB/VoxCPM",
    template: "Official VoxCPM2 runtime",
    setupNotes: ["VoxCPM2 is not listed in the TTS-Audio-Suite supported-engine table. Its official runtime is linked here; suite compatibility is unverified."],
    files: [],
  },
  {
    id: "index-tts", name: "IndexTTS-2.5", slot: "voice", group: "speech",
    purpose: "Acted dialogue with emotion control and reference-based voice cloning.",
    license: {
      label: "Bilibili Model Use License",
      detail: "The current license requires a separate written grant above 100M monthly active users or RMB 1B annual revenue, including affiliates. Review its other use and distribution restrictions.",
      url: "https://huggingface.co/IndexTeam/IndexTTS-2.5/blob/main/LICENSE",
    },
    modelUrl: "https://huggingface.co/IndexTeam/IndexTTS-2.5",
    setupUrl: TTS_AUDIO_SUITE_URL,
    template: "TTS-Audio-Suite · IndexTTS 2.5",
    setupNotes: ["Use the shared suite's IndexTTS 2.5 selection and emotion controls. Its license differs from the Apache-licensed voice choices."],
    files: [],
  },
];

export const AUDIO_GENERATION_GROUPS: ReadonlyArray<{ id: AudioGenerationGroup; title: string; description: string }> = [
  { id: "songs", title: "Singing & full songs", description: "Choose a song engine for lyrics and vocals." },
  { id: "sound", title: "Instrumentals & sound effects", description: "Choose for score beds, ambience, Foley, and one-shots." },
  { id: "speech", title: "Speech & character voices", description: "Design a voice, clone a reference, or shape a performance." },
];

export function audioGenerationOption(id: string | null | undefined): AudioGenerationOption | undefined {
  return AUDIO_GENERATION_OPTIONS.find((option) => option.id === id);
}
