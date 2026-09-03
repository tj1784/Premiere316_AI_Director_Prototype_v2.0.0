import type { EngineKind } from "./types";

export type Engine = {
  id: string;
  name: string;
  org: string;
  repo: string;
  kind: EngineKind;
  note?: string;
};

export const KIND_LABEL: Record<EngineKind, string> = {
  director: "Director",
  image: "Still / T2I",
  video: "Motion / I2V",
  voice: "Voice",
  music: "Score",
  tool: "Tool",
  heritage: "Heritage",
};

export const ENGINES: Engine[] = [
  { id: "minimax-h3", name: "MiniMax H3", org: "MiniMax-AI", repo: "MiniMax-H3", kind: "director" },
  { id: "minimax-m27", name: "MiniMax M2.7", org: "MiniMax-AI", repo: "MiniMax-M2.7", kind: "director" },
  { id: "mini-agent", name: "Mini-Agent", org: "MiniMax-AI", repo: "Mini-Agent", kind: "director" },
  { id: "dramatron", name: "Dramatron", org: "google-deepmind", repo: "dramatron", kind: "director" },
  { id: "longform", name: "Longform", org: "kevboh", repo: "longform", kind: "director" },
  { id: "screenplay-app", name: "ScreenPlay", org: "kelteseth", repo: "ScreenPlay", kind: "director" },
  { id: "openroom", name: "OpenRoom", org: "MiniMax-AI", repo: "OpenRoom", kind: "director", note: "collab room" },
  { id: "flux2", name: "FLUX.2", org: "black-forest-labs", repo: "flux2", kind: "image" },
  { id: "flux", name: "FLUX.1", org: "black-forest-labs", repo: "flux", kind: "image" },
  { id: "flux-krea", name: "FLUX Krea", org: "krea-ai", repo: "flux-krea", kind: "image" },
  { id: "krea-2", name: "Krea 2", org: "krea-ai", repo: "krea-2", kind: "image" },
  { id: "fooocus-mre", name: "Fooocus MRE", org: "krea-ai", repo: "Fooocus-MRE", kind: "image" },
  { id: "bakllava", name: "BakLLaVA", org: "krea-ai", repo: "BakLLaVA", kind: "image" },
  { id: "klein-demo", name: "FLUX.2 Klein", org: "black-forest-labs", repo: "flux-2-klein-api-demo", kind: "image" },
  { id: "self-flow", name: "Self-Flow", org: "black-forest-labs", repo: "Self-Flow", kind: "image" },
  { id: "ltx-2", name: "LTX-2", org: "Lightricks", repo: "LTX-2", kind: "video" },
  { id: "ltx-video", name: "LTX-Video", org: "Lightricks", repo: "LTX-Video", kind: "video" },
  { id: "ltx-desktop", name: "LTX Desktop", org: "Lightricks", repo: "LTX-Desktop", kind: "video" },
  { id: "krea-realtime", name: "Krea Realtime Video", org: "krea-ai", repo: "realtime-video", kind: "video" },
  { id: "cogvideo", name: "CogVideo λ", org: "krea-ai", repo: "CogVideo-lambda", kind: "video" },
  { id: "kintsugi", name: "Kintsugi", org: "Lightricks", repo: "Kintsugi", kind: "video" },
  { id: "index-tts", name: "IndexTTS", org: "index-tts", repo: "index-tts", kind: "voice" },
  { id: "fish-speech", name: "Fish Speech", org: "fishaudio", repo: "fish-speech", kind: "voice" },
  { id: "qwen3-tts", name: "Qwen3 TTS", org: "QwenLM", repo: "Qwen3-TTS", kind: "voice" },
  { id: "voxcpm", name: "VoxCPM", org: "OpenBMB", repo: "VoxCPM", kind: "voice" },
  { id: "rtvc", name: "Real-Time Voice Cloning", org: "CorentinJ", repo: "Real-Time-Voice-Cloning", kind: "voice" },
  { id: "voicestudio", name: "VoiceStudio", org: "debpalash", repo: "VoiceStudio", kind: "voice" },
  { id: "minimax-music3", name: "MiniMax Music3", org: "MiniMax-AI", repo: "MiniMax-Music3", kind: "music" },
  { id: "prompt-gen", name: "Skill Prompt Generator", org: "huangserva", repo: "skill-prompt-generator", kind: "tool" },
  { id: "img-prompt-gen", name: "AI Image Prompt Generator", org: "526christian", repo: "AI-Image-PromptGenerator", kind: "tool" },
  { id: "prompt-search", name: "Prompt Search", org: "krea-ai", repo: "prompt-search", kind: "tool" },
  { id: "open-prompts", name: "Open Prompts", org: "krea-ai", repo: "open-prompts", kind: "tool" },
  { id: "rembg", name: "rembg", org: "krea-ai", repo: "rembg", kind: "tool" },
  { id: "upscaler", name: "Upscaler", org: "krea-ai", repo: "upscaler", kind: "tool" },
  { id: "facedancer", name: "FaceDancer", org: "krea-ai", repo: "FaceDancer", kind: "tool" },
  { id: "kenburns", name: "3D Ken Burns", org: "krea-ai", repo: "3d-ken-burns", kind: "tool" },
  { id: "xyflow", name: "xyflow", org: "krea-ai", repo: "xyflow", kind: "tool" },
  { id: "svelte-konva", name: "svelte-konva", org: "krea-ai", repo: "svelte-konva", kind: "tool" },
  { id: "flux-mcp", name: "FLUX MCP", org: "black-forest-labs", repo: "flux-mcp", kind: "tool" },
  { id: "minimax-mcp", name: "MiniMax MCP", org: "MiniMax-AI", repo: "MiniMax-MCP", kind: "tool" },
  { id: "minimax-mcp-js", name: "MiniMax MCP JS", org: "MiniMax-AI", repo: "MiniMax-MCP-JS", kind: "tool" },
  { id: "minimax-cli", name: "MiniMax CLI", org: "MiniMax-AI", repo: "cli", kind: "tool" },
  { id: "minimax-skills", name: "MiniMax Skills", org: "MiniMax-AI", repo: "skills", kind: "tool" },
  { id: "krea-skills", name: "Krea Skills", org: "krea-ai", repo: "skills", kind: "tool" },
  { id: "bfl-skills", name: "BFL Skills", org: "black-forest-labs", repo: "skills", kind: "tool" },
  { id: "minimax-code-plugins", name: "MiniMax Code Plugins", org: "MiniMax-AI", repo: "MiniMax-Code-Plugins", kind: "tool" },
  { id: "minimax-coding-plan", name: "MiniMax Coding Plan MCP", org: "MiniMax-AI", repo: "MiniMax-Coding-Plan-MCP", kind: "tool" },
  { id: "minimax-h3-awesome", name: "H3 Integration", org: "MiniMax-AI", repo: "awesome-minimax-h3-integration", kind: "tool" },
  { id: "minimax-verifier", name: "Provider Verifier", org: "MiniMax-AI", repo: "MiniMax-Provider-Verifier", kind: "tool" },
  { id: "vllm-omni", name: "vLLM Omni", org: "krea-ai", repo: "vllm-omni", kind: "tool" },
  { id: "krea-diffusers", name: "Krea Diffusers", org: "krea-ai", repo: "diffusers", kind: "tool" },
  { id: "torchtitan", name: "TorchTitan", org: "krea-ai", repo: "torchtitan", kind: "tool" },
  { id: "tailscale-pgproxy", name: "tailscale-pgproxy", org: "krea-ai", repo: "tailscale-pgproxy", kind: "tool" },
  { id: "redis-queues", name: "custom_redis_queues", org: "krea-ai", repo: "custom_redis_queues", kind: "tool" },
  { id: "dlt", name: "dlt", org: "krea-ai", repo: "dlt", kind: "tool" },
  { id: "blackforest", name: "blackforest", org: "black-forest-labs", repo: "blackforest", kind: "tool" },
  { id: "flanimated", name: "FLAnimatedImage", org: "Lightricks", repo: "FLAnimatedImage", kind: "heritage" },
  { id: "svgkit", name: "SVGKit", org: "Lightricks", repo: "SVGKit", kind: "heritage" },
  { id: "yapdb", name: "YapDatabase", org: "Lightricks", repo: "YapDatabase", kind: "heritage" },
  { id: "lottie-ios", name: "lottie-ios", org: "Lightricks", repo: "lottie-ios", kind: "heritage" },
  { id: "nimble", name: "Nimble", org: "Lightricks", repo: "Nimble", kind: "heritage" },
  { id: "pyformance", name: "pyformance", org: "Lightricks", repo: "pyformance", kind: "heritage" },
  { id: "generative-list", name: "Curated Generative AI Tools", org: "ParthaPRay", repo: "Curated-List-of-Generative-AI-Tools", kind: "heritage" },
  { id: "awesome-aitools", name: "Awesome AI Tools", org: "ikaijua", repo: "Awesome-AITools", kind: "heritage" },
  { id: "collective-ai", name: "Collective AI Tools", org: "hanishrao", repo: "collective-ai-tools", kind: "heritage" },
  { id: "top-ai-repos", name: "Top AI repos", org: "ishandutta2007", repo: "Top-AI-repos", kind: "heritage" },
  { id: "topdeeplearning", name: "Top Deep Learning", org: "aymericdamien", repo: "topdeeplearning", kind: "heritage" },
];

export function engineById(id: string) {
  return ENGINES.find((e) => e.id === id);
}

export function imageEngines() {
  return ENGINES.filter((e) => e.kind === "image" && !e.note);
}

export function engineIdForFamily(family: string): string | undefined {
  const map: Record<string, string> = {
    "FLUX.2": "flux2",
    "FLUX.1": "flux",
    "FLUX.2 Klein": "klein-demo",
    "Krea 2": "krea-2",
    "Qwen Image": "flux2",
    Hunyuan3D: "flux2",
  };
  return map[family];
}
