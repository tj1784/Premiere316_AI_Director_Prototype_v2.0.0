let meta = #{
    name: "harrowing-45s-photoreal-prep",
    description: "Prepare (do not render) a photoreal 45s Harrowing of Hell LTX Director package from Latent assets — 16 agents",
    when_to_use: "When preparing a photorealistic ~45 second opening scene package for LTX+Director i2v using existing Latent assets only",
    phases: [
        #{ title: "Inventory", detail: "4 agents catalog Latent assets and storyboard clips" },
        #{ title: "Locks", detail: "4 agents lock style, continuity, bindings, LTX profile" },
        #{ title: "Clips", detail: "6 agents author LTX packages and guide plans for 3 clips" },
        #{ title: "Assemble", detail: "2 agents stitch plan and master report" },
    ],
};

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
let file_schema = #{
    "type": "object",
    "required": ["ok", "path", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "path": #{ "type": "string" },
        "summary": #{ "type": "string" },
        "error": #{ "type": "string" },
        "counts": #{ "type": "object" },
    },
};

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
let root = if args == () { () } else { args.root };
if root == () || root == "" {
    pause("verification", "Pass args.root = absolute path to projects/harrowing_of_hell");
}

let out_dir = if args == () { () } else { args.out_dir };
if out_dir == () || out_dir == "" {
    out_dir = root + "/production/scene-45s-photoreal-prep";
}

let latent_dir = if args == () { () } else { args.latent_dir };
if latent_dir == () || latent_dir == "" {
    latent_dir = root + "/Latent";
}

let ltx_workflow = if args == () { () } else { args.ltx_workflow };
if ltx_workflow == () || ltx_workflow == "" {
    ltx_workflow = "C:/Users/Blokey/Documents/Premiere316_AI_Director_Prototype_v2.0.0/BlokeyUI/ComfyUI/user/default/workflows/Premiere316/patchVideo_Generation LTX+Director-i2v-prompt_replay-fixed(1).json";
}

// Fixed 45s selection: storyboard opening trilogy (~46s @ 24fps, each clip <= 30s LTX cap)
let clip_ids = ["H01-S01-C01", "H01-S01-C02", "H01-S02-C01"];
let clip_targets = ["14s/336f", "14s/336f", "18s/432f"];

log("Preparing 45s photoreal package under " + out_dir);
log("LTX workflow: " + ltx_workflow);
log("Latent dir: " + latent_dir);

// ===========================================================================
// PHASE 1 — Inventory (4 agents)
// ===========================================================================
phase("Inventory");

let inv_jobs = [];

// Agent 1 — characters
let p1 = "";
p1 += "You are the CHARACTER ASSET INVENTORY agent for JESUS: THE HARROWING OF HELL.\n";
p1 += "PREPARE ONLY — do not generate images or video. Do not call image/video APIs.\n\n";
p1 += "MANDATORY TOOL USE:\n";
p1 += "1) list_dir on " + latent_dir + "\n";
p1 += "2) list_dir / grep / read_file on " + root + "/production if needed for character names\n";
p1 += "3) Optionally skim " + root + "/screenplay.md character sections\n\n";
p1 += "TASK: Inventory every Latent file whose name starts with character-, char-, creature-.\n";
p1 += "For each: filename, absolute path, role, preferred version if multiple (highest .vN), notes for photoreal live-action use.\n";
p1 += "Mark which are REQUIRED for the opening 45s package (clips H01-S01-C01, H01-S01-C02, H01-S02-C01):\n";
p1 += "  - Jesus rear/body only early; face NOT ON CAMERA until later storyboard\n";
p1 += "  - Guardians/jailers, righteous souls extras — not Adam face close-ups unless in beat\n";
p1 += "Write JSON to: " + out_dir + "/01-inventory-characters.json\n";
p1 += "Schema: { generatedFor, latentDir, items:[{filename,path,role,version,requiredFor45s,notes}], summary }\n";
p1 += "After write, re-read the file to confirm. Return {ok, path, summary, counts:{items}}.\n";
inv_jobs.push(#{ prompt: p1, label: "inv-characters", capability_mode: "read-write", output_schema: file_schema });

// Agent 2 — locations + props
let p2 = "";
p2 += "You are the LOCATION/PROP ASSET INVENTORY agent for JESUS: THE HARROWING OF HELL.\n";
p2 += "PREPARE ONLY — do not generate media.\n\n";
p2 += "MANDATORY: list_dir " + latent_dir + " and classify files starting with loc-, location-, prop-, artifact-.\n";
p2 += "Also note atmosphere- plates if they read as environment support.\n\n";
p2 += "For opening 45s (Hell pit plunge → fortress torment → rear-only Jesus pass):\n";
p2 += "Prefer: loc-hell-abyss-approach, loc-fissure-shaft, loc-hell-fortress, location-hells-gate-*,\n";
p2 += "loc-inner-chamber-dark, prop-hell-gate, prop-hell-chains, prop-blue-torches, prop-guardian-spear/sword.\n";
p2 += "Pick latest .vN per slug. Write " + out_dir + "/02-inventory-locations-props.json\n";
p2 += "Schema: { items:[{filename,path,category,slug,version,requiredFor45s,notes}], summary }\n";
p2 += "Re-read file. Return {ok, path, summary, counts:{items}}.\n";
inv_jobs.push(#{ prompt: p2, label: "inv-locations-props", capability_mode: "read-write", output_schema: file_schema });

// Agent 3 — fx / crowds / extras
let p3 = "";
p3 += "You are the FX/CROWD/EXTRA ASSET INVENTORY agent for the Harrowing 45s package.\n";
p3 += "PREPARE ONLY — no media generation.\n\n";
p3 += "MANDATORY: list_dir " + latent_dir + " for fx-*, atmosphere-*, extra-*.\n";
p3 += "Map which plates support: pit plunge, steam/ash, chain crack, blue torches, jailers, tormented crowd, gate faces, scale.\n";
p3 += "Write " + out_dir + "/03-inventory-fx-crowds.json\n";
p3 += "Schema: { items:[{filename,path,kind,useIn45s,priority,notes}], summary }\n";
p3 += "Re-read. Return {ok, path, summary, counts:{items}}.\n";
inv_jobs.push(#{ prompt: p3, label: "inv-fx-crowds", capability_mode: "read-write", output_schema: file_schema });

// Agent 4 — storyboard clip extract
let p4 = "";
p4 += "You are the STORYBOARD CLIP EXTRACTOR for a ~45 second photoreal opening package.\n";
p4 += "PREPARE ONLY.\n\n";
p4 += "MANDATORY READS with read_file:\n";
p4 += "1) " + root + "/production/storyboard.json — extract full objects for clips:\n";
p4 += "   H01-S01-C01, H01-S01-C02, H01-S02-C01\n";
p4 += "2) " + root + "/project.json settings (fps, maxDurationSec)\n";
p4 += "3) storyboard defaults + workflowProfile\n\n";
p4 += "Compute seconds = durationFrames/24. Confirm total ~46s and each clip <= 30s (LTX Director hard cap in the active graph).\n";
p4 += "Write " + out_dir + "/04-storyboard-clip-extract.json with the three full clip records plus packageTiming.\n";
p4 += "Return {ok, path, summary, counts:{clips:3}}.\n";
inv_jobs.push(#{ prompt: p4, label: "inv-storyboard", capability_mode: "read-write", output_schema: file_schema });

let inv_results = parallel(inv_jobs);
let inv_ok = 0;
let inv_i = 0;
while inv_i < inv_results.len() {
    let r = inv_results[inv_i];
    if r != () && r.success && r.output != () && r.output.ok == true { inv_ok += 1; }
    inv_i += 1;
}
log("Inventory agents ok: " + inv_ok.to_string() + "/4");

// ===========================================================================
// PHASE 2 — Locks (4 agents)
// ===========================================================================
phase("Locks");

let lock_jobs = [];

// Agent 5 — continuity locks
let p5 = "";
p5 += "You are CONTINUITY LOCK author for the 45s photoreal package.\n";
p5 += "PREPARE ONLY.\n\n";
p5 += "READ:\n";
p5 += "- " + out_dir + "/04-storyboard-clip-extract.json\n";
p5 += "- " + root + "/production/storyboard.json continuityLocks on the three clips\n";
p5 += "- " + root + "/screenplay.md early pages (Jesus descent, rear-only rules)\n\n";
p5 += "Write a strict lock document covering face state, sword state, Jesus wardrobe/wounds,\n";
p5 += "who may appear on camera per clip, forbidden premature reveals, hands/feet anatomy, no modern objects.\n";
p5 += "Output path: " + out_dir + "/05-continuity-locks.md AND " + out_dir + "/05-continuity-locks.json\n";
p5 += "JSON schema: { clips:[{id, faceState, swordState, allowedSubjects, forbidden, locks:[]}], globalRules:[] }\n";
p5 += "Return {ok, path, summary}.\n";
lock_jobs.push(#{ prompt: p5, label: "lock-continuity", capability_mode: "read-write", output_schema: file_schema });

// Agent 6 — photoreal style lock
let p6 = "";
p6 += "You are STYLE LOCK author (photoreal biblical epic, live-action).\n";
p6 += "PREPARE ONLY.\n\n";
p6 += "READ any of: " + root + "/production/prompt-enhancement/KREA2_PROMPT_GUIDE.md,\n";
p6 += root + "/production/prompt-enhancement/SCREENPLAY_BIBLE.md, screenplay palette notes,\n";
p6 += "and sample a character Latent prompt workflow if present under " + root + "/workflows/character-jesus*.api.json.\n\n";
p6 += "Write " + out_dir + "/06-style-lock-photoreal.json with:\n";
p6 += "look (sacred cinematic realism), palette arc for H01, lens language, grain, lighting,\n";
p6 += "negative constraints, aspect 2.39:1 master, working 720x480 LTX, 24fps, silent picture pass policy.\n";
p6 += "Return {ok, path, summary}.\n";
lock_jobs.push(#{ prompt: p6, label: "lock-style", capability_mode: "read-write", output_schema: file_schema });

// Agent 7 — latent binding map
let p7 = "";
p7 += "You are LATENT→SHOT BINDING agent. PREPARE ONLY.\n\n";
p7 += "READ inventories 01,02,03 and clip extract 04 under " + out_dir + ".\n";
p7 += "Verify every bound file EXISTS under " + latent_dir + " using list_dir or read attempts.\n";
p7 += "Bind only existing Latent assets (must use provided assets — no inventing filenames).\n";
p7 += "For each clip H01-S01-C01, H01-S01-C02, H01-S02-C01 produce:\n";
p7 += "  primaryGuideCandidates[], styleOnlyRefs[] (max 3), identityRefs[], environmentRefs[], fxRefs[], propRefs[].\n";
p7 += "Write " + out_dir + "/07-latent-shot-bindings.json\n";
p7 += "Return {ok, path, summary, counts:{clips:3}}.\n";
lock_jobs.push(#{ prompt: p7, label: "lock-bindings", capability_mode: "read-write", output_schema: file_schema });

// Agent 8 — LTX model/profile review
let p8 = "";
p8 += "You are LTX DIRECTOR PIPELINE PROFILE reviewer. PREPARE ONLY — do not queue ComfyUI.\n\n";
p8 += "MANDATORY: Inspect the ComfyUI workflow JSON (read_file; it is large — search/read sections):\n";
p8 += ltx_workflow + "\n\n";
p8 += "Also read storyboard workflowProfile in " + root + "/production/storyboard.json.\n\n";
p8 += "Document ACTIVE stack (mode 0 nodes) vs DISABLED LoRAs (mode 4):\n";
p8 += "Expected active: UNET ltx-2.3-22b-distilled-1.1; LoRA distilled-lora-384 @0.45; LTX2.3_Crisp_Enhance @0.23;\n";
p8 += "VAEs LTX23 video+audio bf16; DualCLIP gemma_3_12B_it_fp8 + ltx-2.3_text_projection; spatial upscaler x2 1.1;\n";
p8 += "Director 24fps, 720x480 maintain aspect, divisible_by 32, guide_strength 1.00, epsilon 0.99,\n";
p8 += "duration cap 30s/720f, sampler euler, CFG 1, stage1 linear_quadratic 16 steps, stage2 ManualSigmas.\n";
p8 += "Disabled (mode 4): HDR IC-LoRA, Cameraman IC-LoRA, dynamic fro09, sulphur distill.\n";
p8 += "Explain why 45s requires THREE separate LTX runs (14+14+18) not one 45s job.\n";
p8 += "Write " + out_dir + "/08-ltx-director-profile.json\n";
p8 += "Return {ok, path, summary}.\n";
lock_jobs.push(#{ prompt: p8, label: "lock-ltx-profile", capability_mode: "read-write", output_schema: file_schema });

let lock_results = parallel(lock_jobs);
let lock_ok = 0;
let lock_i = 0;
while lock_i < lock_results.len() {
    let r = lock_results[lock_i];
    if r != () && r.success && r.output != () && r.output.ok == true { lock_ok += 1; }
    lock_i += 1;
}
log("Lock agents ok: " + lock_ok.to_string() + "/4");

// ===========================================================================
// PHASE 3 — Per-clip packages (6 agents: package + guide plan per clip)
// ===========================================================================
phase("Clips");

let clip_jobs = [];
let ci = 0;
while ci < clip_ids.len() {
    let cid = clip_ids[ci];
    let tgt = clip_targets[ci];

    // package agent
    let pp = "";
    pp += "You are LTX DIRECTOR PROMPT PACKAGE author for clip " + cid + " (" + tgt + ").\n";
    pp += "PREPARE ONLY — write files, do not render video, do not call ComfyUI.\n\n";
    pp += "MANDATORY READS:\n";
    pp += "- " + out_dir + "/04-storyboard-clip-extract.json\n";
    pp += "- " + out_dir + "/05-continuity-locks.json\n";
    pp += "- " + out_dir + "/06-style-lock-photoreal.json\n";
    pp += "- " + out_dir + "/07-latent-shot-bindings.json\n";
    pp += "- " + out_dir + "/08-ltx-director-profile.json\n";
    pp += "- clip fields from " + root + "/production/storyboard.json for " + cid + "\n\n";
    pp += "AUTHOR a Premiere316 LTX Director package matching the graph at:\n";
    pp += ltx_workflow + "\n\n";
    pp += "Include:\n";
    pp += "1) global_prompt (silent picture pass, photoreal live-action biblical epic, 24fps, 2.39:1 intent, continuity locks, beat, camera, transition, hold last 12 frames)\n";
    pp += "2) local segment plan: exactly 3 segments with start/length frames summing to clip durationFrames\n";
    pp += "   Pattern like existing graph: image-start | text-middle | image-end (or text if no end guide yet)\n";
    pp += "3) segment_lengths CSV, local_prompts joined with ' | ', guide_strength '1.00,1.00', epsilon 0.99\n";
    pp += "4) director widgets: frame_rate 24, custom_width 720, custom_height 480, resize maintain aspect ratio\n";
    pp += "5) bound Latent absolute paths for first/end guide placeholders (from bindings; do not invent files)\n";
    pp += "6) negative / forbid list\n";
    pp += "7) audio policy: silent picture pass (generate no intelligible audio) — score may be laid in editorial later\n\n";
    pp += "Write:\n";
    pp += out_dir + "/clips/" + cid + "/ltx-director-package.json\n";
    pp += out_dir + "/clips/" + cid + "/global_prompt.txt\n";
    pp += out_dir + "/clips/" + cid + "/local_prompts.txt\n";
    pp += "Return {ok, path: package json path, summary}.\n";
    clip_jobs.push(#{ prompt: pp, label: "pkg:" + cid, capability_mode: "read-write", output_schema: file_schema });

    // guide frames agent
    let pg = "";
    pg += "You are GUIDE FRAME PLANNER for clip " + cid + ". PREPARE ONLY — no image generation.\n\n";
    pg += "READ bindings, continuity locks, and " + out_dir + "/clips/" + cid + "/ltx-director-package.json if present;\n";
    pg += "also inventories and Latent list_dir " + latent_dir + ".\n\n";
    pg += "Produce a first-frame and end-frame RECIPE that composites/selects ONLY provided Latent assets:\n";
    pg += "which Latent files, how they role as environment/hero/crowd/fx, camera notes from storyboard,\n";
    pg += "and destination paths for future guides (do not invent binary images):\n";
    pg += "  " + out_dir + "/clips/" + cid + "/guides/FIRST_FRAME.plan.md\n";
    pg += "  " + out_dir + "/clips/" + cid + "/guides/END_FRAME.plan.md\n";
    pg += "  " + out_dir + "/clips/" + cid + "/guides/guide-manifest.json\n";
    pg += "guide-manifest lists required Latent paths (must exist) and recommended still-generation method later (out of scope).\n";
    pg += "Return {ok, path: guide-manifest.json, summary}.\n";
    clip_jobs.push(#{ prompt: pg, label: "guide:" + cid, capability_mode: "read-write", output_schema: file_schema });

    ci += 1;
}

let clip_results = parallel(clip_jobs);
let clip_ok = 0;
let clip_j = 0;
while clip_j < clip_results.len() {
    let r = clip_results[clip_j];
    if r != () && r.success && r.output != () && r.output.ok == true { clip_ok += 1; }
    clip_j += 1;
}
log("Clip agents ok: " + clip_ok.to_string() + "/6");

// ===========================================================================
// PHASE 4 — Assemble (2 agents)
// ===========================================================================
phase("Assemble");

// Agent 15 — stitch / edit plan
let p15 = "";
p15 += "You are EDITORIAL STITCH PLANNER for the 45s photoreal package. PREPARE ONLY.\n\n";
p15 += "READ all three clip packages under " + out_dir + "/clips/ and 04-storyboard-clip-extract.json.\n";
p15 += "Design a 45–46s master timeline at 24fps: order H01-S01-C01 → H01-S01-C02 → H01-S02-C01,\n";
p15 += "cut points from storyboard transitions, handle frame holds, no retime that exceeds LTX identity stability,\n";
p15 += "optional score bed path if exists: " + root + "/media/audio/harrowing_of_hell_score_v01.wav (editorial only).\n";
p15 += "Write " + out_dir + "/15-edit-stitch-plan.json and " + out_dir + "/15-edit-stitch-plan.md\n";
p15 += "Return {ok, path, summary}.\n";
let a15 = agent(p15, #{ label: "assemble-stitch", capability_mode: "read-write", output_schema: file_schema });

// Agent 16 — master report + runbook
let p16 = "";
p16 += "You are MASTER PACKAGE ASSEMBLER / RUNBOOK writer. PREPARE ONLY — do not execute ComfyUI.\n\n";
p16 += "READ every artifact under " + out_dir + " (list_dir recursively; read key JSON/MD).\n";
p16 += "Verify: inventories exist; locks exist; each of " + json_encode(clip_ids) + " has ltx-director-package.json;\n";
p16 += "bindings only reference files under " + latent_dir + "; LTX profile notes 30s cap and 3-run plan.\n\n";
p16 += "Write:\n";
p16 += "1) " + out_dir + "/00-MASTER-PACKAGE.json — machine-readable index of all artifacts, models, clips, assets\n";
p16 += "2) " + out_dir + "/00-RUNBOOK.md — human steps to load " + ltx_workflow + " and paste each package (still no auto-render)\n";
p16 += "3) " + out_dir + "/00-QC-CHECKLIST.md — photoreal quality + continuity gate before any render\n\n";
p16 += "If any required artifact missing, set ok=false and list gaps in summary but still write the report of what exists.\n";
p16 += "Return {ok, path: 00-MASTER-PACKAGE.json, summary}.\n";
let a16 = agent(p16, #{ label: "assemble-master", capability_mode: "read-write", output_schema: file_schema });

let final_ok = true;
if a15 == () || !a15.success || a15.output == () || a15.output.ok != true { final_ok = false; }
if a16 == () || !a16.success || a16.output == () || a16.output.ok != true { final_ok = false; }

let report = "";
report += "# Harrowing 45s Photoreal Prep — Workflow Result\n\n";
report += "Root: " + root + "\n";
report += "Out: " + out_dir + "\n";
report += "LTX graph: " + ltx_workflow + "\n";
report += "Clips: H01-S01-C01 (14s) + H01-S01-C02 (14s) + H01-S02-C01 (18s) ≈ 46s\n\n";
report += "Agent scores: inventory " + inv_ok.to_string() + "/4, locks " + lock_ok.to_string() + "/4, clips " + clip_ok.to_string() + "/6, assemble ";
if final_ok { report += "2/2"; } else { report += "incomplete"; }
report += "\n\n";
report += "This workflow PREPARES packages only; it does not render video.\n";

let scratch = write_scratch_file("harrowing-45s-prep-report.md", report);

complete(#{
    summary: report,
    report_path: scratch,
    out_dir: out_dir,
    clips: clip_ids,
    agents: 16,
    inventory_ok: inv_ok,
    locks_ok: lock_ok,
    clips_ok: clip_ok,
    assemble_ok: final_ok,
    ltx_workflow: ltx_workflow,
});
