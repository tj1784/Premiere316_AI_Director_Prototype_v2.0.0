import {
  cueMentionsUnseenBody,
  DEFAULT_ADAPTER,
  FRAMING_BUDGETS,
  RUNTIME_DEFAULTS,
  SETTINGS_TRACE_KEYS,
  visibleRegions,
} from "./constants.ts";
import { mergeSettings, mergeWithTrace } from "./merge.ts";
import { requiredRegions, speechConflict } from "./cue-policy.ts";
import { assertSceneConfig } from "./validation.ts";
import type {
  Beat,
  Catalog,
  CharacterBaseline,
  CompiledOutput,
  CueChannel,
  CueBudget,
  EmotionRecord,
  EmotionVariant,
  Framing,
  Intensity,
  IntensityLevel,
  Line,
  PerformanceSettings,
  RegionOverrides,
  ResolvedBeatOutput,
  ResolvedSettings,
  SceneConfig,
  SelectedCue,
  Selection,
  UnsupportedControl,
  WinningScope,
} from "./types.ts";

export class CompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompileError";
  }
}

export interface CatalogView {
  byId: Map<string, EmotionRecord>;
  variantOf: Map<string, { emotion: EmotionRecord; variant: EmotionVariant }>;
  catalogVersion: string;
}

export function indexCatalog(catalog: Catalog): CatalogView {
  const byId = new Map<string, EmotionRecord>();
  const variantOf = new Map<string, { emotion: EmotionRecord; variant: EmotionVariant }>();
  for (const emotion of catalog.emotions) {
    byId.set(emotion.id, emotion);
    for (const variant of emotion.variants) {
      variantOf.set(variant.id, { emotion, variant });
    }
  }
  return { byId, variantOf, catalogVersion: catalog.catalog_version };
}

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function seededOrder<T>(items: T[], seed: number): T[] {
  const rand = mulberry32(seed);
  const copy = items.map((item, index) => ({ item, index, rank: rand() }));
  copy.sort((a, b) => a.rank - b.rank || a.index - b.index);
  return copy.map((entry) => entry.item);
}

function cueId(emotionId: string, level: Intensity, channel: CueChannel, index: number) {
  return `${emotionId}:L${level}:${channel}:${index}`;
}

export function resolveSelection(
  view: CatalogView,
  selection: Selection,
): { emotion: EmotionRecord; variant: EmotionVariant; level: IntensityLevel; modifier: string } {
  const pair = view.variantOf.get(selection.variant_id);
  if (!pair) {
    throw new CompileError(`Unknown variant '${selection.variant_id}'.`);
  }
  if (pair.emotion.id !== selection.emotion_id) {
    throw new CompileError(
      `Variant '${selection.variant_id}' belongs to '${pair.emotion.id}', not '${selection.emotion_id}'.`,
    );
  }
  const level = pair.emotion.levels.find((entry) => entry.level === selection.intensity);
  if (!level) {
    throw new CompileError(
      `Intensity ${selection.intensity} is not authored for '${selection.emotion_id}'.`,
    );
  }
  const modifier =
    pair.variant.seven_levels.find((entry) => entry.level === selection.intensity)?.modifier ?? "";
  return { emotion: pair.emotion, variant: pair.variant, level, modifier };
}

const authoredBudgets = new WeakMap<ResolvedSettings, Partial<CueBudget>>();

function applyFramingBudget(settings: ResolvedSettings): ResolvedSettings {
  const authored = settings.cue_budget ?? {};
  const resolved = {
    ...settings,
    cue_budget: { ...FRAMING_BUDGETS[settings.framing], ...authored },
  };
  authoredBudgets.set(resolved, authored);
  return resolved;
}

export function resolveLineSettings(
  scene: SceneConfig,
  line: Line,
  sourceFraming?: Framing,
): { settings: ResolvedSettings; trace: Record<string, WinningScope> } {
  const trace: Record<string, WinningScope> = {};
  for (const key of SETTINGS_TRACE_KEYS) {
    trace[key] = "runtime_default";
  }
  let current: Record<string, unknown> = { ...RUNTIME_DEFAULTS };
  if (sourceFraming) {
    current.framing = sourceFraming;
    trace.framing = "shot_plan";
  }
  current = mergeWithTrace(current, scene.scene_defaults, "scene_default", trace);
  const characterOverlay = scene.character_overrides[line.character_id];
  if (characterOverlay) {
    current = mergeWithTrace(current, characterOverlay, "character_override", trace);
  }
  current = mergeWithTrace(current, line.overrides, "line_override", trace);
  const settings = applyFramingBudget(current as unknown as ResolvedSettings);
  if (!settings.cue_budget) {
    settings.cue_budget = FRAMING_BUDGETS[settings.framing];
  }
  return { settings, trace };
}

export function resolveBeatSettings(lineSettings: ResolvedSettings, beat: Beat): ResolvedSettings {
  for (const key of [
    "allow_narration",
    "allow_extra_dialogue",
    "allow_nonverbal_vocalizations",
  ] as const) {
    if (beat.overrides[key] && !lineSettings[key])
      throw new CompileError(`Beat '${beat.beat_id}' cannot escalate ${key}.`);
  }
  if (
    beat.overrides.allowed_sound_events?.some(
      (kind) => !lineSettings.allowed_sound_events.includes(kind),
    )
  )
    throw new CompileError(`Beat '${beat.beat_id}' cannot expand allowed sound events.`);
  const merged = mergeSettings(
    {
      ...lineSettings,
      cue_budget: authoredBudgets.get(lineSettings) ?? lineSettings.cue_budget,
    } as unknown as Record<string, unknown>,
    beat.overrides as unknown as Record<string, unknown>,
  ) as unknown as ResolvedSettings;
  return applyFramingBudget(merged);
}

function validateResolved(view: CatalogView, settings: ResolvedSettings, context: string) {
  const layers = settings.felt_layers ?? [];
  if (layers.length === 0) {
    throw new CompileError(`${context}: a dominant felt selection is required.`);
  }
  const dominant = layers.filter((layer) => layer.role === "dominant");
  if (dominant.length !== 1) {
    throw new CompileError(`${context}: exactly one dominant felt layer is required.`);
  }
  const ids = layers.map((layer) => layer.selection.emotion_id);
  if (new Set(ids).size !== ids.length) {
    throw new CompileError(`${context}: mixed layers cannot repeat the same canonical emotion.`);
  }
  for (const layer of layers) {
    resolveSelection(view, layer.selection);
  }
  if (settings.displayed_selection) {
    resolveSelection(view, settings.displayed_selection);
  }
  if (settings.regulation === "masked" || settings.regulation === "performed") {
    if (!settings.displayed_selection) {
      throw new CompileError(
        `${context}: masked/performed regulation requires a displayed selection.`,
      );
    }
  }
  if (settings.cue_selection_mode === "seeded" && settings.cue_selection_seed == null) {
    throw new CompileError(`${context}: seeded cue selection requires a seed.`);
  }
}

function regionAllowed(
  channel: CueChannel,
  region: string,
  settings: ResolvedSettings,
  framing: Framing,
  text: string,
  spokenText = "",
  replacement = false,
): { ok: boolean; warning?: string } {
  if (
    !replacement &&
    (region === "loudness" ||
      /\b(scream\w*|shout\w*|yell\w*|tear\w*|weep\w*|strik\w*|hitt?ing|punch\w*|slap\w*|embrac\w*|kneel\w*|collapse\w*|run(?:s|ning)?|gasp\w*)\b/i.test(
        text,
      ))
  )
    return {
      ok: false,
      warning: `Catalog option requires an explicit authored regional replacement; felt intensity alone cannot authorize volume, tears, contact or extreme action: ${text}`,
    };
  const conflict = speechConflict(text, Boolean(spokenText));
  if (conflict) return { ok: false, warning: `Omitted instruction: ${conflict}. Review: ${text}` };
  const required = requiredRegions(text, channel, region || undefined);
  if (!required.length) {
    return {
      ok: false,
      warning: `Preset instruction retained for review because its physical regions are not explicit: ${text}`,
    };
  }
  for (const entry of required) {
    const controls =
      entry.channel === "face"
        ? settings.face_overrides
        : entry.channel === "voice"
          ? settings.voice_overrides
          : settings.body_overrides;
    const control = controls?.[entry.region];
    if (
      control?.mode === "omit" ||
      (control?.mode === "replace" &&
        !(replacement && entry.channel === channel && entry.region === region))
    ) {
      return {
        ok: false,
        warning: `Omitted instruction conflicting with the authored ${entry.channel}/${entry.region} ${control.mode} control: ${text}`,
      };
    }
    const visible = visibleRegions(framing, entry.channel);
    if (visible && !visible.has(entry.region)) {
      return {
        ok: false,
        warning: `Omitted instruction requiring ${entry.channel}/${entry.region}, unavailable in ${framing}: ${text}`,
      };
    }
    const filter = settings.region_filters?.[entry.channel];
    if (filter && !filter.includes(entry.region)) {
      return {
        ok: false,
        warning: `Omitted instruction excluded by the ${entry.channel} region filter (${entry.region}): ${text}`,
      };
    }
    if ((settings.cue_budget[entry.channel] ?? 0) <= 0) {
      return {
        ok: false,
        warning: `Omitted instruction because the ${entry.channel} cue budget is zero: ${text}`,
      };
    }
  }
  if (channel === "body" && cueMentionsUnseenBody(text, framing)) {
    return {
      ok: false,
      warning: `Omitted instruction requiring unseen lower-body action in ${framing}: ${text}`,
    };
  }
  if (settings.display_allowance === 0 && required.some((entry) => entry.channel !== "voice")) {
    return {
      ok: false,
      warning: `Omitted physical instruction because outward display allowance is zero: ${text}`,
    };
  }
  return { ok: true };
}

export function selectChannelCues(
  view: CatalogView,
  selection: Selection,
  channel: CueChannel,
  settings: ResolvedSettings,
  warnings: string[],
  spokenText = "",
): SelectedCue[] {
  if (channel === "voice" && !spokenText) return [];
  const budget = settings.cue_budget[channel] ?? 0;
  if (budget <= 0) return [];
  const resolved = resolveSelection(view, selection);
  const choices = resolved.level.cue_choices[channel] ?? [];
  const candidates: SelectedCue[] = choices.map((choice, index) => ({
    id: cueId(resolved.emotion.id, resolved.level.level, channel, index),
    channel,
    region: choice.region,
    text: choice.text,
    source_emotion_id: resolved.emotion.id,
    intensity: resolved.level.level,
  }));

  const explicit = settings.explicit_cue_ids ?? [];
  let pool = explicit.length ? candidates.filter((cue) => explicit.includes(cue.id)) : candidates;

  if (settings.cue_selection_mode === "seeded" && settings.cue_selection_seed != null) {
    const channelSalt = channel === "face" ? 1 : channel === "voice" ? 2 : 3;
    pool = seededOrder(pool, settings.cue_selection_seed + channelSalt * 17);
  }

  const picked: SelectedCue[] = [];
  const used = new Set<string>();
  for (const cue of pool) {
    const regions = requiredRegions(cue.text, channel, cue.region);
    if (regions.some((entry) => used.has(`${entry.channel}/${entry.region}`))) continue;
    const allow = regionAllowed(
      channel,
      cue.region,
      settings,
      settings.framing,
      cue.text,
      spokenText,
    );
    if (!allow.ok) {
      if (allow.warning) warnings.push(allow.warning);
      continue;
    }
    picked.push(cue);
    for (const entry of regions) used.add(`${entry.channel}/${entry.region}`);
    if (picked.length >= budget) break;
  }
  return picked;
}

function replacementCues(
  channel: CueChannel,
  overrides: RegionOverrides | undefined,
  emotionId: string,
  intensity: Intensity,
): SelectedCue[] {
  if (!overrides) return [];
  const extra: SelectedCue[] = [];
  for (const [region, control] of Object.entries(overrides)) {
    if (control.mode === "replace" && control.instruction) {
      extra.push({
        id: `${emotionId}:L${intensity}:${channel}:replace:${region}`,
        channel,
        region,
        text: control.instruction,
        source_emotion_id: emotionId,
        intensity,
      });
    }
  }
  return extra;
}

function sentenceJoin(parts: string[]): string {
  const cleaned = parts
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (part.endsWith(".") ? part : `${part}.`));
  const unique: string[] = [];
  for (const sentence of cleaned) {
    if (!unique.some((existing) => existing.toLowerCase() === sentence.toLowerCase())) {
      unique.push(sentence);
    }
  }
  return unique.join(" ");
}

function framingLead(framing: Framing, spokenEmpty: boolean): string {
  switch (framing) {
    case "extreme_close_up":
      return "Hold an extreme close-up on the face. Emphasize visible eye and mouth changes; do not invent a wider shot.";
    case "close_up":
      return "Hold a close-up. Keep lower-body action out of the instruction; no forced walking or full-body reframing.";
    case "medium":
      return "Hold a medium, waist-up frame. Hands and torso may carry subtext; do not reframe to a wide.";
    case "wide":
      return "Hold a wide shot. Prioritize readable posture and distance; tiny eyelid cues can be omitted.";
    case "audio_only":
      return "";
    case "silent_reaction":
      return spokenEmpty
        ? "Show a silent reaction. No new camera framing is required."
        : "Treat this as a silent reaction; do not invent spoken text.";
  }
}

function identityVoiceLead(character: CharacterBaseline | undefined): string {
  if (!character) return "";
  if (character.identity_locked) {
    if (character.voice_reference) {
      return "Keep the approved voice. Emotion changes delivery around that identity; do not replace accent, age, or speaker.";
    }
    return "Preserve the established voice identity; do not invent a new speaker.";
  }
  return "";
}

function collectCuesForSettings(
  view: CatalogView,
  settings: ResolvedSettings,
  warnings: string[],
  spokenText: string,
): SelectedCue[] {
  const dominant = settings.felt_layers.find((layer) => layer.role === "dominant");
  if (!dominant) return [];
  const displaySource = settings.displayed_selection ?? dominant.selection;
  if (!displaySource) return [];

  const visualSelection = displaySource;
  const vocalSelection = settings.framing === "silent_reaction" ? null : visualSelection;

  const cues: SelectedCue[] = [
    ...selectChannelCues(view, visualSelection, "face", settings, warnings, spokenText),
    ...(vocalSelection
      ? selectChannelCues(view, vocalSelection, "voice", settings, warnings, spokenText)
      : []),
    ...selectChannelCues(view, visualSelection, "body", settings, warnings, spokenText),
  ];

  const resolved = resolveSelection(view, visualSelection);
  const replacements = [
    ...replacementCues("face", settings.face_overrides, resolved.emotion.id, resolved.level.level),
    ...replacementCues(
      "voice",
      settings.voice_overrides,
      resolved.emotion.id,
      resolved.level.level,
    ),
    ...replacementCues("body", settings.body_overrides, resolved.emotion.id, resolved.level.level),
  ];
  for (const extra of replacements) {
    if (extra.channel === "voice" && !spokenText) continue;
    const allow = regionAllowed(
      extra.channel,
      extra.region,
      settings,
      settings.framing,
      extra.text,
      spokenText,
      true,
    );
    if (!allow.ok) {
      warnings.push(
        allow.warning ??
          `Regional replacement in ${extra.region} cannot bypass framing or region filters.`,
      );
      continue;
    }
    const idx = cues.findIndex(
      (cue) => cue.channel === extra.channel && cue.region === extra.region,
    );
    if (idx >= 0) cues[idx] = extra;
    else cues.push(extra);
  }
  // Authored replacements take the available slots; they never enlarge a budget.
  const counts = { face: 0, voice: 0, body: 0 };
  return cues
    .sort((a, b) => Number(b.id.includes(":replace:")) - Number(a.id.includes(":replace:")))
    .filter((cue) => {
      if (counts[cue.channel] >= settings.cue_budget[cue.channel]) {
        warnings.push(`Omitted cue ${cue.id}; the ${cue.channel} cue budget is full.`);
        return false;
      }
      counts[cue.channel]++;
      return true;
    });
}

function intentContext(view: CatalogView, settings: ResolvedSettings): string[] {
  const parts: string[] = [];
  const fields = [
    ["Director objective", settings.objective],
    ["Relationship context", settings.relationship_context],
    ["Appraisal context", settings.appraisal],
    ["Physical context", settings.physical_context],
  ];
  for (const [label, value] of fields) {
    if (value)
      parts.push(
        `${label} (authored context, not additional speech or actions): ${JSON.stringify(value)}`,
      );
  }
  for (const layer of settings.felt_layers.filter((entry) => entry.role === "secondary")) {
    const resolved = resolveSelection(view, layer.selection);
    parts.push(
      `Internal secondary feeling: ${resolved.emotion.label}, level ${layer.selection.intensity}, editorial weight ${layer.layer_weight}; contextual motive: ${JSON.stringify(resolved.variant.objective)}. Keep this as subtext under the dominant/displayed performance; do not superimpose another set of gestures`,
    );
  }
  return parts;
}

function composeDirections(
  view: CatalogView,
  settings: ResolvedSettings,
  cues: SelectedCue[],
  character: CharacterBaseline | undefined,
  spokenText: string,
  warnings: string[],
  cinematic = false,
  framingAuthored = true,
): { video: string; delivery: string } {
  const dominant = settings.felt_layers.find((layer) => layer.role === "dominant")!;
  const felt = resolveSelection(view, dominant.selection);
  const displaySel = settings.displayed_selection ?? dominant.selection;
  const displayed = resolveSelection(view, displaySel);
  const visual = settings.framing !== "audio_only";
  const vocal = Boolean(spokenText) && settings.framing !== "silent_reaction";
  const context = cinematic
    ? [
        settings.objective && `The character wants to ${settings.objective}`,
        settings.relationship_context,
        settings.appraisal,
        settings.physical_context,
      ].filter(Boolean)
    : intentContext(view, settings);
  const picture: string[] = visual
    ? [
        framingAuthored
          ? framingLead(settings.framing, !spokenText)
          : "Preserve the established shot composition",
        ...context,
      ]
    : [];
  const voice: string[] = vocal ? [identityVoiceLead(character), ...context] : [];
  const regulation = `Regulation: ${settings.regulation}. Outward display allowance: ${settings.display_allowance} on the editorial 0–1 scale; felt intensity remains level ${dominant.selection.intensity}. ${settings.display_allowance <= 0.35 || settings.regulation === "restrained" || settings.regulation === "suppressed" ? "Contain the amplitude of selected cues" : "Use the selected cues within this allowance"}; do not add gestures to fill unused channels`;
  const outward = cinematic
    ? `${settings.regulation === "open" ? "Allow an open expression" : `Keep the performance ${settings.regulation}`}. ${settings.display_allowance <= 0.35 ? "Keep outward expression contained" : "Use only the selected physical and vocal behavior"}; depth of feeling does not increase volume or add gestures`
    : regulation;
  if (visual) picture.push(outward);
  if (vocal) voice.push(outward);
  if (settings.arousal_override !== null) {
    const arousal = cinematic
      ? `${settings.arousal_override < 0.35 ? "Low" : settings.arousal_override > 0.7 ? "High" : "Moderate"} internal energy without changing vocal volume`
      : `Arousal intent: ${settings.arousal_override} on the editorial 0–1 scale, independent of pitch, loudness, and felt intensity`;
    if (visual) picture.push(arousal);
    if (vocal) voice.push(arousal);
  }
  if (settings.regulation === "masked" || settings.regulation === "performed") {
    const mask = cinematic
      ? `Show ${displayed.emotion.label.toLowerCase()} while keeping ${felt.emotion.label.toLowerCase()} private`
      : `Outward state: ${displayed.emotion.label} (${displayed.variant.label}), level ${displaySel.intensity}. Hidden ${felt.emotion.label} remains internal; do not add a second physical or vocal display`;
    if (visual) picture.push(mask);
    if (vocal) voice.push(mask);
  }
  if (settings.continuity.from_line_id && !settings.continuity.restart_onset) {
    const continuity = cinematic
      ? "Continue the established performance and physical state, including position, contact, props, clothing and injuries; do not replay completed actions"
      : `Continue the established performance from line ${JSON.stringify(settings.continuity.from_line_id)}; preserve carryover instead of replaying onset`;
    if (visual) picture.push(continuity);
    if (vocal) voice.push(continuity);
  }
  for (const cue of cues) {
    if (cue.channel === "voice") {
      if (vocal) voice.push(cue.text);
    } else if (visual) picture.push(cue.text);
  }

  const used = new Set(
    cues.flatMap((cue) =>
      requiredRegions(cue.text, cue.channel, cue.region).map(
        (entry) => `${entry.channel}/${entry.region}`,
      ),
    ),
  );
  const counts = { face: 0, voice: 0, body: 0 };
  for (const cue of cues) counts[cue.channel]++;
  const modifiers: { source: string; text: string; channel?: CueChannel }[] = [
    { source: `${displayed.variant.id}:L${displaySel.intensity}`, text: displayed.modifier },
    {
      source: `${displayed.variant.id}:face`,
      text: displayed.variant.face_modifier,
      channel: "face",
    },
    {
      source: `${displayed.variant.id}:voice`,
      text: displayed.variant.voice_modifier,
      channel: "voice",
    },
    {
      source: `${displayed.variant.id}:body`,
      text: displayed.variant.body_modifier,
      channel: "body",
    },
    { source: `${displayed.variant.id}:timing`, text: displayed.variant.timing_modifier },
  ];
  if (
    settings.regulation === "restrained" ||
    settings.regulation === "suppressed" ||
    settings.display_allowance <= 0.35
  ) {
    modifiers.unshift({
      source: `${displayed.emotion.id}:L${displaySel.intensity}:restrained`,
      text: displayed.level.restrained_alternative,
    });
  }
  for (const modifier of modifiers) {
    if (!modifier.text) continue;
    const required = requiredRegions(modifier.text, modifier.channel);
    const channels = new Set(required.map((entry) => entry.channel));
    const channel = modifier.channel ?? (channels.size === 1 ? required[0]?.channel : undefined);
    const note = (reason: string) =>
      warnings.push(`Preset ${modifier.source} retained for review (${reason}): ${modifier.text}`);
    if (!channel || !required.length || [...channels].some((kind) => kind !== channel)) {
      note("needs an authored channel/region assignment");
      continue;
    }
    if ((channel === "voice" && !vocal) || (channel !== "voice" && !visual)) {
      note("channel is inactive for this line");
      continue;
    }
    const allow = regionAllowed(channel, "", settings, settings.framing, modifier.text, spokenText);
    if (!allow.ok) {
      note(allow.warning ?? "excluded by the resolved controls");
      continue;
    }
    if (required.some((entry) => used.has(`${entry.channel}/${entry.region}`))) {
      note("overlaps a selected cue; requires an explicit compatible replacement or separate beat");
      continue;
    }
    if (counts[channel] >= settings.cue_budget[channel]) {
      note("channel cue budget is full");
      continue;
    }
    if (channel === "voice") voice.push(modifier.text);
    else picture.push(modifier.text);
    counts[channel]++;
    for (const entry of required) used.add(`${entry.channel}/${entry.region}`);
  }
  if (visual && (settings.framing === "close_up" || settings.framing === "extreme_close_up")) {
    picture.push("No new camera framing is required");
  }
  if (vocal) {
    voice.push(
      "Use only separately authored, timed sound events; do not insert a laugh, sob, gasp, cry, or other vocal event from a preset",
    );
    voice.push("Speak the authorized words exactly; do not rewrite, summarize, or omit them");
  }
  return { video: visual ? sentenceJoin(picture) : "", delivery: vocal ? sentenceJoin(voice) : "" };
}

function capabilityExports(adapter: SceneConfig["adapter"]): UnsupportedControl[] {
  const caps = adapter?.capabilities ?? DEFAULT_ADAPTER.capabilities;
  const rows: UnsupportedControl[] = [];
  for (const [control, status] of Object.entries(caps)) {
    if (status !== "supported" && status !== "native") {
      rows.push({
        control,
        status,
        reason:
          status === "unverified"
            ? "Illustrative text export only. No generation backend has been configured or tested."
            : `Adapter reports ${status} for ${control}.`,
      });
    }
  }
  if (rows.length === 0) {
    rows.push({
      control: "active_backend",
      status: "unverified",
      reason: "Illustrative text export only. No generation backend has been configured or tested.",
    });
  }
  return rows;
}

function validateBeats(line: Line, warnings: string[]) {
  const text = line.spoken_text;
  for (const beat of line.beats) {
    const timing = beat.timing;
    if (
      !Number.isFinite(timing.start) ||
      !Number.isFinite(timing.end) ||
      timing.start < 0 ||
      timing.end < 0
    ) {
      throw new CompileError(`Beat '${beat.beat_id}' requires finite, nonnegative timing bounds.`);
    }
    if (timing.end <= timing.start) {
      throw new CompileError(`Beat '${beat.beat_id}' has a non-positive time range.`);
    }
    if (timing.coordinate === "normalized" && timing.end > 1) {
      throw new CompileError(`Beat '${beat.beat_id}' normalized end exceeds 1.`);
    }
    if (
      timing.coordinate === "seconds" &&
      line.duration_seconds != null &&
      timing.end > line.duration_seconds
    ) {
      warnings.push(`Beat '${beat.beat_id}' extends past the planned line duration.`);
    }
    if (timing.coordinate === "text_codepoints") {
      if (!Number.isInteger(timing.start) || !Number.isInteger(timing.end)) {
        throw new CompileError(
          `Beat '${beat.beat_id}' text span must use integer code-point indices.`,
        );
      }
      const units = Array.from(text);
      if (timing.end > units.length) {
        throw new CompileError(`Beat '${beat.beat_id}' text span exceeds spoken_text length.`);
      }
      if (timing.anchor_text) {
        const slice = units.slice(timing.start, timing.end).join("");
        if (slice !== timing.anchor_text) {
          throw new CompileError(
            `Beat '${beat.beat_id}' anchor_text does not match spoken_text[${timing.start}:${timing.end}].`,
          );
        }
      }
    }
  }
}

function filterSoundEvents(line: Line, settings: ResolvedSettings, warnings: string[]) {
  if (!settings.allow_nonverbal_vocalizations) {
    if (line.authored_sound_events.length) {
      warnings.push(
        "Authored sound events were omitted because nonverbal vocalizations are disabled.",
      );
    }
    return [];
  }
  const allowed = new Set(settings.allowed_sound_events);
  const exported = [];
  for (const event of line.authored_sound_events) {
    if (!allowed.has(event.kind)) {
      warnings.push(`Sound event '${event.kind}' is not in the allowed list.`);
      continue;
    }
    if (
      line.duration_seconds != null &&
      event.start_seconds + event.duration_seconds > line.duration_seconds
    ) {
      warnings.push(`Sound event '${event.kind}' exceeds the planned line duration.`);
      continue;
    }
    exported.push(event);
  }
  return exported;
}

export function compileLine(
  catalog: Catalog,
  scene: SceneConfig,
  line: Line,
  sourceFraming?: Framing,
): CompiledOutput {
  try {
    const lineInScene =
      Array.isArray(scene?.lines) && scene.lines.some((entry) => entry.line_id === line?.line_id);
    // Public callers may pass a separate line object; validate that exact object
    // together with all other scene scopes in the same schema-validation pass.
    const input = lineInScene
      ? {
          ...scene,
          lines: scene.lines.map((entry) => (entry.line_id === line.line_id ? line : entry)),
        }
      : scene;
    assertSceneConfig(input, catalog.catalog_version);
    if (!lineInScene) throw new Error("Line is not part of the scene.");
  } catch (error) {
    throw new CompileError(error instanceof Error ? error.message : "Invalid scene configuration.");
  }
  const view = indexCatalog(catalog);
  const warnings: string[] = [];
  if (!scene.character_baselines[line.character_id]) {
    throw new CompileError(
      `Line '${line.line_id}' references unknown character '${line.character_id}'.`,
    );
  }
  const { settings, trace } = resolveLineSettings(scene, line, sourceFraming);
  if (trace.framing === "runtime_default")
    warnings.push(
      "Framing source is missing or ambiguous. Close-up is only a cue-visibility fallback; preserve the shot plan or choose an explicit framing override.",
    );
  validateResolved(view, settings, line.line_id);
  validateBeats(line, warnings);

  const character = scene.character_baselines[line.character_id];
  const spoken = line.spoken_text;
  if (!spoken) settings.cue_budget = { ...settings.cue_budget, voice: 0 };
  if (settings.allow_extra_dialogue) {
    warnings.push("allow_extra_dialogue is on; the compiler still will not invent speech.");
  }

  const lineCues = collectCuesForSettings(view, settings, warnings, spoken);
  const { video, delivery } = composeDirections(
    view,
    settings,
    lineCues,
    character,
    spoken,
    warnings,
    false,
    trace.framing !== "runtime_default",
  );
  const cinematic = composeDirections(
    view,
    settings,
    lineCues,
    character,
    spoken,
    [],
    true,
    trace.framing !== "runtime_default",
  );

  const resolvedBeats: ResolvedBeatOutput[] = line.beats.map((beat) => {
    const beatSettings = resolveBeatSettings(settings, beat);
    if (!spoken) beatSettings.cue_budget = { ...beatSettings.cue_budget, voice: 0 };
    validateResolved(view, beatSettings, `${line.line_id}/${beat.beat_id}`);
    const beatCues = collectCuesForSettings(view, beatSettings, warnings, spoken);
    const directions = composeDirections(view, beatSettings, beatCues, character, spoken, warnings);
    return {
      beat_id: beat.beat_id,
      timing: beat.timing,
      resolved_settings: beatSettings,
      selected_cue_ids: beatCues.map((cue) => cue.id),
      visual_direction: directions.video,
      delivery_direction: directions.delivery,
    };
  });

  if (line.duration_seconds != null && spoken.trim()) {
    warnings.push(
      "Requested clip duration is a planning target; no audio timing has been measured.",
    );
  }

  const profileIds = [
    ...settings.felt_layers.map((layer) => layer.selection.variant_id),
    ...(settings.displayed_selection ? [settings.displayed_selection.variant_id] : []),
  ];

  const winning: Record<string, string> = {};
  for (const key of SETTINGS_TRACE_KEYS) {
    if (key in (settings as unknown as Record<string, unknown>) || key in trace) {
      if (
        ["region_filters", "face_overrides", "explicit_cue_ids"].includes(key) &&
        !(key in scene.scene_defaults) &&
        !(key in (scene.character_overrides[line.character_id] ?? {})) &&
        !(key in line.overrides)
      ) {
        continue;
      }
      winning[key] = trace[key] ?? "runtime_default";
    }
  }
  // Keep expected-example keys even when the value is a runtime default that
  // scene_defaults already populated.
  for (const key of Object.keys(trace)) {
    if (key.includes(".") || key in (settings as unknown as Record<string, unknown>)) {
      winning[key] = trace[key];
    }
  }

  return {
    cinematic: { version: "1.0.0", action: cinematic.video, delivery: cinematic.delivery },
    schema_version: "1.0.0",
    scene_id: scene.scene_id,
    line_id: line.line_id,
    character_id: line.character_id,
    spoken_text: spoken,
    video_direction: video,
    delivery_direction: delivery,
    performance_json: {
      catalog_version: view.catalogVersion,
      resolved_settings: settings,
      selected_cue_ids: lineCues.map((cue) => cue.id),
      resolved_beats: resolvedBeats,
      beat_notes: [
        "Compiler-selected cue IDs are recorded. Directions are assembled from authored cues, variant modifiers, framing, and regulation — spoken text is never rewritten.",
      ],
    },
    sound_events: filterSoundEvents(line, settings, warnings),
    unsupported_controls: capabilityExports(scene.adapter),
    warnings: [...new Set(warnings)],
    resolution_trace: {
      catalog_version: view.catalogVersion,
      profile_ids: profileIds,
      winning_scopes: winning,
    },
  };
}

export function compileScene(catalog: Catalog, scene: SceneConfig): CompiledOutput[] {
  return scene.lines.map((line) => compileLine(catalog, scene, line));
}

export function packetText(output: CompiledOutput): string {
  const cues = output.performance_json.selected_cue_ids.join("\n");
  const beats = output.performance_json.resolved_beats
    .map((beat) => {
      const span =
        beat.timing.anchor_text ??
        `${beat.timing.coordinate} ${beat.timing.start}–${beat.timing.end}`;
      return `BEAT ${beat.beat_id} [${span}]\nPicture: ${beat.visual_direction}${
        beat.delivery_direction ? `\nVoice: ${beat.delivery_direction}` : ""
      }`;
    })
    .join("\n\n");
  return [
    `CUEBOARD ${output.resolution_trace.catalog_version}`,
    `Scene ${output.scene_id} · Line ${output.line_id} · ${output.character_id}`,
    "",
    "SPOKEN TEXT",
    output.spoken_text.length ? output.spoken_text : "(silent reaction)",
    "",
    "PICTURE",
    output.video_direction || "(none — audio only)",
    "",
    "VOICE",
    output.delivery_direction || "(none)",
    "",
    beats ? `BEATS\n${beats}\n` : "",
    cues ? `CUE IDS\n${cues}` : "CUE IDS\n(none)",
    "",
    "WARNINGS",
    output.warnings.length
      ? `${output.warnings.length} warning(s). Review the detailed warnings separately in the preview or JSON diagnostics before using this packet.`
      : "None",
  ]
    .filter((block) => block !== "")
    .join("\n");
}
