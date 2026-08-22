const david = {
  id: "character-david",
  name: "David",
  category: "character",
  variant: "Identity",
  approvalCurrent: true,
  activeVersion: 1,
  file: "david.png",
  dependencies: []
};

export function health({ qwen = true, comfy = true } = {}) {
  return {
    comfy,
    ffmpeg: true,
    lmStudio: true,
    providers: {
      qwenVoiceDesign: { available: qwen, ready: qwen },
      indexTts: { available: true, ready: true },
      comfyui: { available: comfy }
    },
    capabilities: { qwenVoiceDesign: qwen, indexTtsVoiceClone: true }
  };
}

export function project({ items = [david] } = {}) {
  return {
    project: {
      id: "agency_uat",
      slug: "agency_uat",
      name: "Agency UAT",
      category: "feature",
      assets: { items }
    }
  };
}

export function storyboard() {
  return {
    storyboard: {
      schemaVersion: "premiere316.storyboard.v1",
      clips: { "H04-S13-C03": { id: "H04-S13-C03", firstFrameId: "H04-S13-C03-F01" } },
      frames: { "H04-S13-C03-F01": { id: "H04-S13-C03-F01", references: [] } },
      segments: { "segment-c03-01": { id: "segment-c03-01", clipId: "H04-S13-C03", order: 1, prompt: "David looks up" } },
      videoPlans: {},
      referenceBindings: {}
    },
    summary: { clips: 1, frames: 1, segments: 1 }
  };
}

export function recordings(unmatched = true) {
  return {
    sources: unmatched ? [{
      id: "take-unmatched-01",
      fileName: "UNKNOWN SPEAKER.wav",
      previewUrl: "/api/projects/agency_uat/character-voice-sources/take-unmatched-01/audio"
    }] : []
  };
}

export function voice(overrides = {}) {
  return {
    id: "voice-david",
    name: "David",
    category: "voice",
    variant: "Voice Design",
    approvalCurrent: false,
    activeVersion: 1,
    file: "david.wav",
    dependencies: ["character-david"],
    versions: [{ v: 1, file: "david.wav" }],
    ...overrides
  };
}

export { david };
