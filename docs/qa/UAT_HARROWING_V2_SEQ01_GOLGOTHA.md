# UAT — Harrowing of Hell V2 · one scene

**Project:** `harrowing_of_hell_v2`  
**URL:** http://127.0.0.1:8789/screenplay?project=harrowing_of_hell_v2  
**Scene under test:** **SEQ-01 Golgotha** (`EXT. GOLGOTHA - DAY` → veil tear → death → spirit departure → Deep Way), billed `00:00–03:00`  
**Origin:** live API + served SPA + project files on 2026-08-22  
**Result:** **FAIL — scene cannot be finished.** Pipeline stops after approved screenplay + planned assets. No image, voice, storyboard, director clip, or sequence media exists for this scene.

## Remediation 2026-08-22

Code and project seed landed. SEQ-01 now has a shot plan, storyboard, LTX timeline clips, missing identity/voice cards, and a live Krea generate queue. **Not all UAT items are closed:** Flux style-lock weights are still missing, LTX Director is still down, the sequence editor still has no media files, and voice still belongs in Create Sound.

See the operator summary in chat for the issue-by-issue closeout.

## What was walked

| Stage | Endpoint / surface | Result |
|---|---|---|
| Screenplay | `/screenplay?project=harrowing_of_hell_v2` | Loaded. Approved. 117,610-char imported 30-min script. |
| Assets | `/api/projects/harrowing_of_hell_v2` · 158 items | Manifest exists. All `planned`. Zero versions. |
| Prompt dev | `/api/projects/.../assets/enhance-prompts` | Stuck mid-run. 11/158. 2 failures. |
| Asset generation | POST `.../assets/:id/generate` and `generate-all` | Blocked. Image workflows not ready. Voice workflow disabled. |
| Storyboard | GET `/api/projects/.../storyboard` | **404** Storyboard not found. |
| Director / LTX | `/api/integrations/ltx/status` | `connected: false` on `:8791`. |
| Comfy | `/api/health` | `comfy: false`, `comfyProxyReady: false`. |
| Sequence | `/api/projects/.../editor` | Empty library. 0 videos, 0 audio, 0 timeline clips. |
| Media disk | `projects/harrowing_of_hell_v2/media/**` | **No generated files.** |

Health snapshot: ComfyUI offline; LM Studio online but **required screenplay model not loaded**; Qwen TTS / Voice Design / IndexTTS installed but unused for this scene; ffmpeg present.

## Scene 1 required package (minimum)

Present as **prompts only** (no files, no approval, no versions):

- Jesus identity sheet, close-up, crucified body
- Mary, John, Magdalene, repentant thief, centurion
- Golgotha wide, Temple Holy Place wide
- First-frame Golgotha darkness
- Extras: women at the cross, Roman ring, temple priests
- Voices: Jesus, Mary, thief, centurion (**not John**)
- Sound: living darkness, veil tear, earthquake, final heartbeat
- Music: Golgotha darkness and death

## Issue list

### Blockers — scene cannot finish

1. **ComfyUI is offline** (`127.0.0.1:8188`). Image generation, storyboard push, and Comfy picker are dead. Health: `comfy:false`, `comfyProxyReady:false`.
2. **Every Flux/Krea/ACE image-audio workflow reports not ready** with `Missing nodes: UNETLoader, CLIPLoader, …`. This is the offline schema check collapsing into a node-missing error. Users cannot tell “engine off” from “nodes not installed.”
3. **`generate-all` lies.** POST with Golgotha asset IDs returned **HTTP 200, `queued: 0`, `skipped: 158`**. Unready workflows are silently omitted. The UI store does not surface `queued`. Operator can believe generation started.
4. **Single-asset generate fails closed** with the same missing-node string for `character-jesus-christ-close-up` (409). No “start Comfy” remediation in the API payload.
5. **Voice assets cannot use Asset Generation.** `qwen3-tts-voice-design-1.7b` is `ready: false`: “Use Create Sound → Voice Design. The legacy ComfyUI Qwen generator is disabled.” Scene 1 still has four voice cards on the old generate path.
6. **Prompt Composer queue is also blocked.** POST `/prompt-generations` → 409 “selected prompt workflow has not passed a current runtime readiness check.” Curated Flux IDs say they are “not connected to the prompt-composer queue.”
7. **No storyboard document.** GET `/api/projects/harrowing_of_hell_v2/storyboard` → `Storyboard not found`. POST `/storyboard/structure` also 400 for the same reason. Director has nothing to push.
8. **No shot plan.** `screenplay.shotPlan` is absent. Creating one requires the pinned LM Studio model, which is **installed but not loaded** (`screenplayModelAvailable: false`). Chat/generate/revise/shot-plan all 503.
9. **LTX Director is down.** `/api/integrations/ltx/status` → `connected:false` at `127.0.0.1:8791`. No I2V path for the 180s Golgotha beat (bible estimates 180 provisional clips across the film).
10. **Sequence is empty.** Editor library: 0 video / 0 audio. Project `sequence.clips`: 0. No take to replace, play, or export. Scene 1 cannot be reviewed in the NLE.

### Screenplay / product-truth

11. **Title mismatch.** Script title is *JESUS: THE VIOLENT DESCENT / THE HARROWING OF HADES*. Project name is *Harrowing of Hell V2*.
12. **Runtime mismatch.** Screenplay header: **30 minutes**. Screenplay settings: **`runtimeMinutes: 10`**. Breakdown: 30 minutes / 180 provisional clips. UI defaults shot plan to 15s × 40 shots = 10 minutes — cannot cover SEQ-01–10.
13. **Screenplay stats are wrong for this format.** `screenplayStats()` counts dialogue only with **20 leading spaces**. This imported script is left-aligned. Dialogue count = **0** vs ~226 speaker lines. Runtime badge looks for `**Runtime:**` and misses `TARGET RUNTIME: 30 MINUTES`.
14. **Default workspace is Chat**, not Preview. Opening `/screenplay` lands on chat. First stored chat message is the **entire imported screenplay** dumped as a user turn. Model is unavailable, so the page looks like a failed conversation.
15. **Duplicate slugline.** `INT. TEMPLE - HOLY PLACE - SAME` appears twice (intercut + veil rip). Fine dramatically; shot-plan/scene counters will double-count Temple unless INTERCUT is modeled.
16. **No unrepentant thief.** Only the repentant thief is written and asseted. If the three-cross wide is generated from “three crosses,” the second thief has no identity lock.
17. **Named “A SOLDIER” with sponge** is not a character asset. Only `extra-roman-ring` + centurion exist. Continuity of the wine-sponge soldier is undefined.
18. **John has no voice asset.** He has dialogue-adjacent action and is addressed; Mary/Jesus/thief/centurion have voice cards, John does not.
19. **Scene 1 has a first frame, not a last frame.** Last-frame asset is resurrection dawn (SEQ-10). Spirit-leaving / fall into the Deep Way has no end-frame still.

### Prompt development

20. **Prompt enhance is stuck.** Job `enhance_mt47z7tl` status=`running`, `active=false`, `finishedAt=null`, **11/158**, started `10:12:42Z`. Looks abandoned, still presented as running.
21. **Two enhance failures, max turns.** `character-john-beloved-disciple-appearance` and `character-adam-first-man-freed-appearance`: `Grok agent exited 1: Max turns reached`. John is a SEQ-01 principal and is the **only required Golgotha character without an enhanced prompt**.
22. **Enhance coverage is identity-heavy, location-light.** Jesus/Mary/Magdalene/thief/centurion enhanced; **Golgotha, Temple, first-frame, wardrobe, extras, voices, sounds are not.**
23. **John’s prompt is thinner than the others.** Four-view lock is copy-pasted twice; body is a short paragraph. After enhance failure he remains the weakest SEQ-01 identity sheet.
24. **No scene filter on Prompt Development.** 158-asset enhance is all-or-nothing. Cannot run “SEQ-01 only.”

### Assets / generation UX

25. **158 assets, 0 generated, 0 approved.** `approvalCurrent` is false for every item. Generation gate is satisfied for screenplay approval, then dies on workflow readiness.
26. **Asset generate path vs Create Sound path is split.** Scene 1 voices sit in the asset bible but the only ready speech runtime is standalone Voice Design, which is a different workspace.
27. **`ltx-2.3-native-audio` is ready** and assigned to 17 sound items, but there are **no generated stems** and no scene-scoped generate action that reports per-file results.
28. **Guide-frame assets are not a storyboard.** Two still prompts exist; no frame IDs, no video plans, no references bound.
29. **Production breakdown says `render_ready_shot_manifest: false`.** Honest. UI does not surface this as a gate before Director.

### Director / sequence / routing

30. **`/comfy` is not a canonical route.** `navigation.js` maps unknown paths to `/edit`. App still has `WORKSPACE_ROUTE.comfy = "/comfy"` and `openComfyBlocked()` uses it. User-requested Comfy URL can miss the Comfy workspace.
31. **Sequence drop/import cannot populate this scene** until files exist. Editor is a valid empty state, but there is no “build SEQ-01 from storyboard” action.
32. **No missing-work index for planned assets.** `collectMissingWork` treats library items without files as missing, but with 158 planned cards the nav counts become noise rather than a SEQ-01 checklist.
33. **Served SPA is a production Vite build** (`index-Ch7BGqcq.js`). Vite dev server on 5198 is down. Fine for UAT, but Gate 1 import-report / stall-clock strings are **not** in the running sequence chunk. Running NLE ≠ latest source.

### Process / environment

34. **No browser UAT session was possible beyond HTTP.** No Playwright against the live origin in this pass; findings are API/source/file backed. Visual overflow/contrast not claimed.
35. **Cannot claim pixel, decode, or Comfy ACK evidence.** Those require Comfy + LTX + at least one generated take.

## SEQ-01 finish criteria (not met)

- [ ] Screenplay stats match the imported 30-min left-aligned script
- [ ] Shot plan covering Golgotha + Temple intercut (~180s)
- [ ] Storyboard with first/last frames and video plans
- [ ] Generated + approved stills: Jesus crucified, Mary, John, Magdalene, thief, centurion, Golgotha, Temple
- [ ] Voice lines: thief plea, Jesus sayings, Mary, centurion
- [ ] Diegetic: darkness bed, veil tear, quake, last breath
- [ ] At least one LTX/Comfy take in the bin
- [ ] Sequence plays Golgotha → veil → death → spirit step without an empty program

## Recommended next operator actions

1. Start ComfyUI on 8188 and confirm object_info (so “missing nodes” becomes a real install problem or goes away).
2. Load the pinned screenplay model in LM Studio, or stop defaulting the screenplay page to Chat.
3. Stop or finish the stuck Grok enhance job; retry John only.
4. Do not use `generate-all` until it fails closed when `queued === 0`.
5. Build a **SEQ-01-only** shot plan / storyboard before touching Hades.
6. Generate voices in **Create Sound → Voice Design**, not Asset Generation.
7. Start LTX Director (`:8791`) only after stills exist.

Until those land, SEQ-01 is a **script + prompt bible**, not a finished scene.
