import type { Picture, Shot } from "./types.ts";
import {
  INTERNAL_PHASES,
  hydrateProductFlow,
  parseMovieIntent,
  pausedInternalPhase,
  allPhaseReviewsOn,
  PHASE_REVIEW_DEFAULTS,
  type DepartmentRunState,
  type InternalPhase,
  type ProductFlowState,
  type ProductTouchpoint,
} from "./product-flow.ts";
import {
  RESEARCH_BIBLE_SECTION_KEYS,
  appendResearchVersion,
  cloneResearchContent,
  hydratePictureResearch,
  hydrateResearchSections,
  researchSectionsArePopulated,
  type PictureResearchBible,
  type ResearchContent,
} from "../research/bible.ts";
import { addResearchSource } from "../research/source-ledger.ts";
import { appendScreenplayVersion, approveCurrentScreenplay, makePictureScreenplay } from "./screenplay.ts";
import { parseScreenplayHierarchy, sceneNodes } from "./screenplay-hierarchy.ts";
import { parseScreenplayQaReport } from "./screenplay-qa.ts";
import { createProductionBreakdown } from "../production/breakdown.ts";
import { deterministicFountainBreakdown } from "../production/deterministic-extractor.ts";
import type { BreakdownRequirementDraft, ProductionCategory } from "../production/types.ts";
import { compilePicture } from "./prompt-compiler.ts";
import { seedVisualDevelopmentFromPicture } from "../visual-development.ts";
import { seedCinematographyFromPicture } from "../cinematography.ts";
import { migratePicturePerformance } from "../performance/persistence.ts";
import { savePromptVersion, hydrateGenerateGates } from "../production/generate-gates.ts";
import type { ScreenplayModelRef } from "./screenplay.ts";

export const CONFIGURED_MODEL_UNAVAILABLE =
  "Configured AI model unavailable. Start LM Studio Local API Server and serve a model, then Rescan.";
export const MANUAL_FALLBACK_LABEL = "Manual fallback — no AI movie plan has been generated.";

export type MoviePlanGenerate = (input: { stepId: InternalPhase; system: string; prompt: string }) => Promise<{ text: string }>;

export type MoviePlanRuntime = {
  available: boolean;
  reason: string;
  servedModelId: string | null;
  displayName?: string;
  generate: MoviePlanGenerate | null;
};

export type MoviePlanResult = {
  picture: Picture;
  flow: ProductFlowState;
  providerCalled: boolean;
  calls: InternalPhase[];
};

function step(id: InternalPhase, status: DepartmentRunState, message: string) {
  return { id, status, message };
}

function applyIntake(picture: Picture, now: number): Picture {
  const brief = parseMovieIntent(picture.intake.concept || picture.intake.premise || picture.intake.logline || picture.logline || picture.title);
  const intake = {
    ...picture.intake,
    title: picture.intake.title || brief.title,
    concept: picture.intake.concept || brief.concept,
    premise: picture.intake.premise || brief.premise,
    logline: picture.intake.logline || brief.logline,
    genre: picture.intake.genre || brief.genre,
    tone: picture.intake.tone || brief.tone,
    productionStyle: picture.intake.productionStyle || brief.productionStyle,
    targetRuntimeMinutes: picture.intake.targetRuntimeMinutes || brief.targetRuntimeMinutes,
    updatedAt: now,
  };
  return {
    ...picture,
    title: !picture.title || picture.title === "Untitled" || picture.title === "Untitled Picture" ? intake.title : picture.title,
    logline: picture.logline || intake.logline,
    genre: picture.genre || intake.genre,
    tone: picture.tone || intake.tone,
    runtimeMinutes: picture.runtimeMinutes || intake.targetRuntimeMinutes,
    intake,
    updatedAt: now,
  };
}

export function failClosedMoviePlan(picture: Picture, input: { reason?: string; now?: number }): MoviePlanResult {
  const now = input.now ?? Date.now();
  const reason = input.reason ?? CONFIGURED_MODEL_UNAVAILABLE;
  const next = applyIntake(picture, now);
  const flow = hydrateProductFlow(next.productFlow);
  const steps = INTERNAL_PHASES.map((id) => step(id, "failed", reason));
  const nextFlow: ProductFlowState = {
    ...flow,
    steps,
    llamaAvailable: false,
    nextTouchpoint: "intake",
    lastRunAt: now,
    executed: false,
    servedModelId: null,
    manualFallback: true,
  };
  return {
    picture: { ...next, productFlow: nextFlow, updatedAt: now },
    flow: nextFlow,
    providerCalled: false,
    calls: [],
  };
}

export function extractJsonObject(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced?.[1] ?? text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Model did not return a JSON object.");
  const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Model JSON was not an object.");
  return parsed as Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function modelRef(servedModelId: string, displayName?: string): ScreenplayModelRef {
  return {
    id: servedModelId,
    servedModelId,
    localCatalogModelId: null,
    displayName: displayName ?? servedModelId,
    checkpoint: servedModelId,
    precision: "",
    quantization: "",
    contextLength: null,
    sizeBytes: 0,
    runtimeAdapter: "LM Studio OpenAI-compatible local API",
    status: "ready",
    statusReason: "",
  };
}

function researchPrompt(picture: Picture): { system: string; prompt: string } {
  return {
    system: "You are Premiere316 research. Return only JSON. Do not browse the web. Do not mention providers or modes.",
    prompt: `Write a Research Bible for this picture as JSON with keys:
title, sections, characters, locations, sources.
sections must include every key: ${RESEARCH_BIBLE_SECTION_KEYS.join(", ")}
Each section value must be non-empty prose.
characters: [{name, role, age, look, arc}]
locations: [{name, description, lighting}]
sources: [{title, locator, quote}]
Picture: ${JSON.stringify({
      title: picture.title,
      concept: picture.intake.concept || picture.intake.premise || picture.logline,
      genre: picture.intake.genre || picture.genre,
      tone: picture.intake.tone || picture.tone,
      runtimeMinutes: picture.intake.targetRuntimeMinutes || picture.runtimeMinutes,
    })}`,
  };
}

function screenplayPrompt(picture: Picture, research: ResearchContent): { system: string; prompt: string } {
  return {
    system: "You are Premiere316 screenwriter. Return JSON { fountain }. Fountain must include INT./EXT. sluglines. No web. Separate from QA.",
    prompt: `Write a playable Fountain screenplay/trailer from Intake and Research.
JSON: { "title": string, "fountain": string }
Research sections: ${JSON.stringify(research.sections)}
Intake: ${picture.intake.concept || picture.intake.premise || picture.logline}`,
  };
}

function qaPrompt(fountain: string): { system: string; prompt: string } {
  return {
    system: "You are Premiere316 Story Doctor QA. You did not write this screenplay. Return JSON { findings: [{ category, severity, summary, recommendation, revisionRequired }] }. fountainUnchanged is implied. Do not rewrite the Fountain.",
    prompt: `Critique this Fountain. Categories: SOURCE DRIFT, CHARACTER DRIFT, PACING ISSUE, CONTINUITY ISSUE, DIALOGUE ISSUE, THEMATIC DRIFT, CINEMATOGRAPHY OPPORTUNITY.
${fountain}`,
  };
}

function breakdownPrompt(fountain: string): { system: string; prompt: string } {
  return {
    system: "You are Premiere316 script supervisor. Return JSON { assets: [{ category, name, description }] }. Categories: character, location, wardrobe, prop, vehicle, creature, vfx, voice, sound, music.",
    prompt: `Extract production assets from this Fountain.\n${fountain}`,
  };
}

function visualPrompt(picture: Picture): { system: string; prompt: string } {
  return {
    system: "You are Premiere316 visual development. Return JSON { intent, palette, motifs }.",
    prompt: `Look development for ${picture.title}. Tone: ${picture.tone}. Characters: ${picture.characters.map((item) => item.name).join(", ")}`,
  };
}

function cinemaPrompt(picture: Picture): { system: string; prompt: string } {
  return {
    system: "You are Premiere316 cinematography. Return JSON { thesis, lensLanguage, lighting, movement }.",
    prompt: `Camera language for ${picture.title}. ${picture.research?.content.sections.cinematographyResearch ?? ""}`,
  };
}

function performancePrompt(picture: Picture): { system: string; prompt: string } {
  return {
    system: "You are Premiere316 performance. Return JSON { notes, shots: [{ description, type, durationSec, camera, lens, emotion }] }.",
    prompt: `Performance and shot plan for ${picture.title}. Fountain:\n${picture.screenplay.workingFountain}`,
  };
}

function shotsPrompt(picture: Picture): { system: string; prompt: string } {
  return {
    system: "You are Premiere316 shot director. Return JSON { shots: [{ description, type, durationSec, camera, lens, cameraMove, emotion, expression }] }.",
    prompt: `Shot list for ${picture.title}. Fountain:\n${picture.screenplay.workingFountain}`,
  };
}

function applyResearchJson(bible: PictureResearchBible, parsed: Record<string, unknown>, now: number, id: string): PictureResearchBible {
  const sections = hydrateResearchSections(parsed.sections);
  const content: ResearchContent = {
    ...cloneResearchContent(bible.content),
    sections,
    risks: sections.risksDisputes || bible.content.risks,
    feasibility: sections.aiProductionFeasibility || bible.content.feasibility,
    notes: sections.storyTheme || bible.content.notes,
    cinematographyManifesto: {
      ...bible.content.cinematographyManifesto,
      thesis: sections.cinematographyResearch || bible.content.cinematographyManifesto.thesis,
      texture: sections.visualIdentity || bible.content.cinematographyManifesto.texture,
      soundWorld: sections.soundMusicWorld || bible.content.cinematographyManifesto.soundWorld,
    },
  };
  const sources = Array.isArray(parsed.sources) ? parsed.sources : [];
  for (const raw of sources) {
    const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const added = addResearchSource(content.sources, {
      id: `${id}:src:${content.sources.length}`,
      title: asString(item.title) || "Generated source",
      locator: asString(item.locator) || "generated-research",
      quote: asString(item.quote),
      confidence: "C",
      importedFrom: null,
      createdAt: now,
    });
    if (!("error" in added)) content.sources = added.sources;
  }
  if (!researchSectionsArePopulated(sections)) {
    throw new Error("Research Bible sections were empty after the model call.");
  }
  const drafted = appendResearchVersion(bible, {
    id,
    label: "Generated Research Draft",
    kind: "draft",
    scope: "whole-picture",
    createdAt: now,
    sourceVersionId: bible.currentVersionId,
    content,
  });
  return appendResearchVersion(drafted, {
    id: `${id}:approved`,
    label: "Automation-approved Research Bible",
    kind: "approved",
    scope: "whole-picture",
    createdAt: now,
    sourceVersionId: drafted.currentVersionId,
    content,
  });
}

function peopleFromResearch(parsed: Record<string, unknown>): Picture["characters"] {
  const rows = Array.isArray(parsed.characters) ? parsed.characters : [];
  return rows.map((raw, index) => {
    const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    return {
      id: `ch${index + 1}`,
      name: asString(item.name) || `Character ${index + 1}`,
      role: asString(item.role),
      age: asString(item.age),
      look: asString(item.look),
      arc: asString(item.arc),
      voiceId: "ara",
    };
  });
}

function placesFromResearch(parsed: Record<string, unknown>): Picture["locations"] {
  const rows = Array.isArray(parsed.locations) ? parsed.locations : [];
  return rows.map((raw, index) => {
    const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    return {
      id: `loc${index + 1}`,
      name: asString(item.name) || `Location ${index + 1}`,
      description: asString(item.description),
      lighting: asString(item.lighting),
    };
  });
}

const CATEGORY_SET = new Set<string>(["character", "location", "wardrobe", "prop", "vehicle", "creature", "vfx", "voice", "sound", "music", "hair_makeup", "practical_effect", "set_dressing", "signage", "continuity", "other"]);

export async function executeMoviePlan(picture: Picture, input: {
  runtime: MoviePlanRuntime;
  now?: number;
  id?: () => string;
}): Promise<MoviePlanResult> {
  const now = input.now ?? Date.now();
  const id = input.id ?? (() => `mp:${now}:${Math.random().toString(36).slice(2, 8)}`);
  const calls: InternalPhase[] = [];
  if (!input.runtime.available || !input.runtime.generate || !input.runtime.servedModelId) {
    return failClosedMoviePlan(picture, { reason: input.runtime.reason || CONFIGURED_MODEL_UNAVAILABLE, now });
  }
  const generate = input.runtime.generate;
  let next = applyIntake(picture, now);
  const flow = hydrateProductFlow(next.productFlow);
  const reviewPhases = flow.reviewInternalPhases && !Object.values(flow.reviewPhases).some(Boolean) ? allPhaseReviewsOn() : flow.reviewPhases;
  const steps: ProductFlowState["steps"] = [];

  const finish = (status: DepartmentRunState, phase: InternalPhase, message: string, touch: ProductTouchpoint): MoviePlanResult => {
    const remaining = INTERNAL_PHASES.filter((item) => !steps.some((row) => row.id === item));
    for (const item of remaining) {
      steps.push(step(item, item === phase ? status : "blocked", item === phase ? message : `Blocked after ${phase}: ${message}`));
    }
    const nextFlow: ProductFlowState = {
      ...flow,
      reviewPhases,
      steps,
      llamaAvailable: true,
      nextTouchpoint: touch,
      lastRunAt: now,
      executed: calls.length > 0,
      servedModelId: input.runtime.servedModelId,
      manualFallback: false,
    };
    return { picture: { ...next, productFlow: nextFlow, updatedAt: now }, flow: nextFlow, providerCalled: calls.length > 0, calls };
  };

  const maybePause = (phase: InternalPhase, message: string): MoviePlanResult | null => {
    steps.push(step(phase, flow.reviewInternalPhases && reviewPhases[phase] ? "waitingForOptionalUserReview" : "draftReady", message));
    if (flow.reviewInternalPhases && reviewPhases[phase]) {
      return finish("waitingForOptionalUserReview", phase, `Paused for optional ${phase} review.`, "intake");
    }
    return null;
  };

  try {
    calls.push("research");
    const researchAsk = researchPrompt(next);
    const researchText = await generate({ stepId: "research", ...researchAsk });
    const researchJson = extractJsonObject(researchText.text);
    const research = applyResearchJson(hydratePictureResearch(next.research, next.intake, now), researchJson, now, id());
    next = {
      ...next,
      research,
      characters: peopleFromResearch(researchJson).length ? peopleFromResearch(researchJson) : next.characters,
      locations: placesFromResearch(researchJson).length ? placesFromResearch(researchJson) : next.locations,
    };
    const pausedResearch = maybePause("research", "Research Bible generated from the configured model.");
    if (pausedResearch) return pausedResearch;

    calls.push("screenplay");
    const screenAsk = screenplayPrompt(next, research.content);
    const screenText = await generate({ stepId: "screenplay", ...screenAsk });
    let fountain = asString(extractJsonObject(screenText.text).fountain) || screenText.text.trim();
    if (!/^(INT\.|EXT\.|INT\.\/EXT\.|I\/E\.)/im.test(fountain)) throw new Error("Screenplay missing INT./EXT. sluglines.");
    let screenplay = appendScreenplayVersion(next.screenplay.schemaVersion ? next.screenplay : makePictureScreenplay(next.intake.workflow, null, now), {
      id: id(),
      label: "Generated Screenplay",
      kind: "draft",
      fountain,
      createdAt: now,
      model: modelRef(input.runtime.servedModelId, input.runtime.displayName),
      workflow: next.intake.workflow,
      pass: null,
      sourceVersionId: next.screenplay.currentVersionId,
      settings: null,
    });
    next = { ...next, screenplay, screenplayFountain: fountain };
    const pausedScreen = maybePause("screenplay", "Screenplay generated from the configured model.");
    if (pausedScreen) return pausedScreen;

    calls.push("screenplayQa");
    const qaAsk = qaPrompt(fountain);
    const qaText = await generate({ stepId: "screenplayQa", ...qaAsk });
    const qa = parseScreenplayQaReport(JSON.stringify(extractJsonObject(qaText.text)), id(), now, modelRef(input.runtime.servedModelId, input.runtime.displayName), "qa-critic");
    if ("error" in qa || !qa.findings.length) throw new Error("QA report was empty.");
    screenplay = approveCurrentScreenplay({ ...screenplay, lastQaReport: { id: qa.id, createdAt: qa.createdAt, modelId: qa.model.id, servedModelId: qa.model.servedModelId, displayName: qa.model.displayName, findings: qa.findings, fountainUnchanged: true } }, id(), now);
    next = { ...next, screenplay, screenplayFountain: screenplay.workingFountain };
    const pausedQa = maybePause("screenplayQa", "QA critique generated in a separate model context.");
    if (pausedQa) return pausedQa;

    calls.push("breakdown");
    const breakAsk = breakdownPrompt(screenplay.workingFountain);
    const breakText = await generate({ stepId: "breakdown", ...breakAsk });
    const hierarchy = parseScreenplayHierarchy(screenplay.workingFountain);
    const scenes = sceneNodes(hierarchy).map((scene) => ({ id: scene.id, slugline: scene.slugline ?? scene.title }));
    if (!scenes.length) throw new Error("Approved screenplay has no scenes.");
    const parsedAssets = extractJsonObject(breakText.text).assets;
    const llmDrafts: BreakdownRequirementDraft[] = Array.isArray(parsedAssets)
      ? parsedAssets.map((raw, index) => {
        const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
        const category = CATEGORY_SET.has(asString(item.category)) ? asString(item.category) as ProductionCategory : "other";
        return {
          id: `req:${index}:${asString(item.name) || index}`,
          category,
          name: asString(item.name) || `Asset ${index + 1}`,
          description: asString(item.description) || asString(item.name),
          sceneIds: [scenes[0].id],
          confidence: "C",
          evidenceNote: "Extracted from generated screenplay.",
        };
      })
      : [];
    const approvedInput = {
      pictureId: next.id,
      versionId: screenplay.approvedVersionId ?? screenplay.currentVersionId ?? id(),
      status: "APPROVED" as const,
      fountain: screenplay.workingFountain,
      scenes,
      socialWorld: [],
    };
    const fallback = deterministicFountainBreakdown({
      screenplayVersionId: approvedInput.versionId,
      fountain: approvedInput.fountain,
      scenes,
      socialWorld: [],
    });
    const drafts = [...llmDrafts, ...fallback.filter((item) => !llmDrafts.some((draft) => draft.name.toLocaleLowerCase() === item.name.toLocaleLowerCase()))];
    if (!drafts.length) throw new Error("No production assets were extracted.");
    const production = createProductionBreakdown(approvedInput, drafts, now);
    next = {
      ...next,
      production,
      scenes: scenes.map((scene, index) => ({ id: scene.id, act: 1, slugline: scene.slugline, summary: scene.slugline, emotionalBeat: "", durationSec: 8 })),
      characters: next.characters.length ? next.characters : production.assets.filter((asset) => asset.category === "character").map((asset, index) => ({ id: asset.id, name: asset.name, role: asset.canonicalSpec.identity, age: "", look: asset.canonicalSpec.visualDescription, arc: "", voiceId: "ara" })),
      locations: next.locations.length ? next.locations : production.assets.filter((asset) => asset.category === "location").map((asset) => ({ id: asset.id, name: asset.name, description: asset.canonicalSpec.visualDescription, lighting: "" })),
      props: production.assets.filter((asset) => asset.category === "prop").map((asset) => ({ id: asset.id, name: asset.name, description: asset.canonicalSpec.visualDescription })),
      wardrobe: production.assets.filter((asset) => asset.category === "wardrobe").map((asset) => ({ id: asset.id, name: asset.name, description: asset.canonicalSpec.visualDescription })),
      vfx: production.assets.filter((asset) => asset.category === "vfx").map((asset) => ({ id: asset.id, name: asset.name, description: asset.canonicalSpec.visualDescription })),
    };
    const pausedBreak = maybePause("breakdown", `${production.assets.length} assets extracted from the generated screenplay.`);
    if (pausedBreak) return pausedBreak;

    calls.push("visualDevelopment");
    const visAsk = visualPrompt(next);
    const visText = await generate({ stepId: "visualDevelopment", ...visAsk });
    const vis = extractJsonObject(visText.text);
    const visualDevelopment = seedVisualDevelopmentFromPicture(next, now);
    if (visualDevelopment.boards[0]) {
      visualDevelopment.boards[0] = {
        ...visualDevelopment.boards[0],
        intent: asString(vis.intent) || visualDevelopment.boards[0].intent,
        palette: Array.isArray(vis.palette) ? vis.palette.map(asString).filter(Boolean) : visualDevelopment.boards[0].palette,
        motifs: Array.isArray(vis.motifs) ? vis.motifs.map(asString).filter(Boolean) : visualDevelopment.boards[0].motifs,
      };
    }
    next = { ...next, visualDevelopment };
    const pausedVis = maybePause("visualDevelopment", "Visual development drafted from generated research.");
    if (pausedVis) return pausedVis;

    calls.push("cinematography");
    const cineAsk = cinemaPrompt(next);
    const cineText = await generate({ stepId: "cinematography", ...cineAsk });
    const cine = extractJsonObject(cineText.text);
    next = { ...next, cinematography: seedCinematographyFromPicture(next, now) };
    if (next.cinematography?.manifestoVersions[0]) {
      next.cinematography.manifestoVersions[0] = {
        ...next.cinematography.manifestoVersions[0],
        thesis: asString(cine.thesis) || next.cinematography.manifestoVersions[0].thesis,
      };
    }
    const pausedCine = maybePause("cinematography", "Cinematography plan drafted from generated research.");
    if (pausedCine) return pausedCine;

    calls.push("performance");
    const perfAsk = performancePrompt(next);
    await generate({ stepId: "performance", ...perfAsk });
    next = { ...next, performance: migratePicturePerformance(next) };
    const pausedPerf = maybePause("performance", "Performance workspace drafted from the generated screenplay.");
    if (pausedPerf) return pausedPerf;

    calls.push("shots");
    const shotAsk = shotsPrompt(next);
    const shotText = await generate({ stepId: "shots", ...shotAsk });
    const shotRows = extractJsonObject(shotText.text).shots;
    const sceneId = next.scenes[0]?.id ?? "SCENE-001";
    const shots: Shot[] = Array.isArray(shotRows)
      ? shotRows.map((raw, index) => {
        const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
        return {
          id: `sh${index + 1}`,
          sceneId,
          index: index + 1,
          type: asString(item.type) || "coverage",
          description: asString(item.description) || `Shot ${index + 1}`,
          durationSec: Number(item.durationSec) || 6,
          camera: asString(item.camera) || "wide",
          lens: asString(item.lens) || "35mm",
          cameraMove: asString(item.cameraMove) || "static",
          emotion: asString(item.emotion),
          expression: asString(item.expression),
          t2iPrompt: "",
          i2vPrompt: "",
          t2voicePrompt: "",
        };
      })
      : [];
    if (!shots.length) throw new Error("Shot list was empty.");
    next = { ...next, shots };
    const pausedShots = maybePause("shots", `${shots.length} shots planned from the generated screenplay.`);
    if (pausedShots) return pausedShots;

    calls.push("promptLab");
    next = compilePicture(next);
    let gates = hydrateGenerateGates(next.generateGates, next);
    for (const shot of next.shots) {
      if (!shot.t2iPrompt) continue;
      gates = savePromptVersion(gates, {
        gate: "assets",
        shotId: shot.id,
        assetId: null,
        kind: "asset",
        text: shot.t2iPrompt,
        assetRefIds: next.production?.assets.slice(0, 3).map((asset) => asset.id) ?? [],
        firstFrameId: null,
        lastFrameId: null,
      });
    }
    next = { ...next, generateGates: gates };
    steps.push(step("promptLab", "draftReady", "Asset Gate prompts compiled from the generated plan."));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const phase = calls.at(-1) ?? "research";
    return finish("failed", phase, message, "intake");
  }

  const nextFlow: ProductFlowState = {
    ...flow,
    reviewPhases,
    steps,
    llamaAvailable: true,
    nextTouchpoint: "asset-approval",
    lastRunAt: now,
    executed: true,
    servedModelId: input.runtime.servedModelId,
    manualFallback: false,
  };
  return { picture: { ...next, productFlow: nextFlow, updatedAt: now }, flow: nextFlow, providerCalled: true, calls };
}

export async function executeResearchDraft(picture: Picture, input: { runtime: MoviePlanRuntime; now?: number; id?: () => string }): Promise<MoviePlanResult> {
  const now = input.now ?? Date.now();
  if (!input.runtime.available || !input.runtime.generate || !input.runtime.servedModelId) {
    return failClosedMoviePlan(picture, { reason: input.runtime.reason || CONFIGURED_MODEL_UNAVAILABLE, now });
  }
  const ask = researchPrompt(picture);
  const text = await input.runtime.generate({ stepId: "research", ...ask });
  const parsed = extractJsonObject(text.text);
  const research = applyResearchJson(hydratePictureResearch(picture.research, picture.intake, now), parsed, now, (input.id ?? (() => `rs:${now}`))());
  const flow = hydrateProductFlow(picture.productFlow);
  const nextFlow: ProductFlowState = {
    ...flow,
    steps: [{ id: "research", status: "draftReady", message: "Research Bible generated from the configured model." }],
    llamaAvailable: true,
    nextTouchpoint: flow.nextTouchpoint,
    lastRunAt: now,
    executed: true,
    servedModelId: input.runtime.servedModelId,
    manualFallback: false,
  };
  return {
    picture: {
      ...picture,
      research,
      characters: peopleFromResearch(parsed).length ? peopleFromResearch(parsed) : picture.characters,
      locations: placesFromResearch(parsed).length ? placesFromResearch(parsed) : picture.locations,
      productFlow: nextFlow,
      updatedAt: now,
    },
    flow: nextFlow,
    providerCalled: true,
    calls: ["research"],
  };
}

export { pausedInternalPhase, PHASE_REVIEW_DEFAULTS };
