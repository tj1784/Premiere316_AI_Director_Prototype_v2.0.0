from pathlib import Path

root = Path(r"C:\Users\Blokey\Documents\Premiere316_AI_Director_Prototype_v2.0.0")
p = root / "director-webapp" / "premiere-api-delegation.mjs"
text = p.read_text(encoding="utf-8")
marker = "const SEMANTIC_ROLE_ALIASES = Object.freeze({"
if "HARROWING_AAA_I2V_GENERATE_OPTION" in text:
    print("premiere-api-delegation already patched")
else:
    insert = '''export const HARROWING_AAA_I2V_GENERATE_OPTION = Object.freeze({
  id: "harrowing_aaa_i2v_segmented",
  label: "Harrowing AAA I2V · segmented",
  generationMode: LTX25_PREMIERE316_PROFILE.generationMode,
  queueMode: "segments",
  workflowProfileId: LTX25_PREMIERE316_PROFILE.id,
  directorWorkflow: "BlokeyUI/ComfyUI/user/default/workflows/Premiere316/LTX2.5_Premiere316.json",
  catalogWorkflow: "BlokeyUI/ComfyUI/user/default/workflows/Premiere316/02_GENERATE_VIDEO_LTX_2.5_Harrowing_AAA.json",
  description: "One I2V Comfy job per authored segment. First frame is graph-wired. Ingredients stay IC-LoRA/identity, never extra timeline frames."
});

export const PREMIERE_GENERATE_OPTIONS = Object.freeze([
  HARROWING_AAA_I2V_GENERATE_OPTION,
  Object.freeze({
    id: "ltx25_premiere316_i2v",
    label: "LTX2.5 Premiere316 I2V · segmented",
    generationMode: LTX25_PREMIERE316_PROFILE.generationMode,
    queueMode: "segments",
    workflowProfileId: LTX25_PREMIERE316_PROFILE.id,
    directorWorkflow: "BlokeyUI/ComfyUI/user/default/workflows/Premiere316/LTX2.5_Premiere316.json",
    catalogWorkflow: "BlokeyUI/ComfyUI/user/default/workflows/Premiere316/LTX2.5_Premiere316.json",
    description: "Compiler-bound Premiere316 subgraph used by LTX Director Queue All."
  }),
  Object.freeze({
    id: "t2v_with_semantic_references",
    label: "Semantic T2V",
    generationMode: "t2v_with_semantic_references",
    queueMode: "timeline",
    workflowProfileId: "ltx-2.5-t2v-semantic-reference-resolver",
    directorWorkflow: null,
    catalogWorkflow: "workflows/storyboard-ltx25-t2v-semantic-reference.ui.json",
    description: "Single semantic T2V timeline job. Music-video clips stay on this path."
  })
]);

export function generateOptionForMode(generationMode, selectedId = null) {
  if (selectedId) {
    const match = PREMIERE_GENERATE_OPTIONS.find((option) => option.id === selectedId);
    if (match) return match;
  }
  return PREMIERE_GENERATE_OPTIONS.find((option) => option.generationMode === generationMode)
    || HARROWING_AAA_I2V_GENERATE_OPTION;
}

'''
    if marker not in text:
        raise SystemExit("marker missing in premiere-api-delegation.mjs")
    p.write_text(text.replace(marker, insert + marker, 1), encoding="utf-8")
    print("patched premiere-api-delegation.mjs")
