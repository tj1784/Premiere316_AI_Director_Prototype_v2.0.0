import type { CompiledOutput, UnsupportedControl } from "./types.ts";

export type EngineProfile = "ltx-prose-1" | "h3-ref2va-1";
export type PromptSpeaker = {
  label: string;
  language?: string;
  imageTag?: string;
  audioTag?: string;
};

/** Engine text only. Diagnostic packets and source IDs never enter this boundary. */
export function serializePerformance(input: {
  profile: EngineProfile;
  lines: CompiledOutput[];
  speakers: Record<string, PromptSpeaker>;
  basePrompt?: string;
  overallSoundscape?: string;
  music?: string;
}) {
  const findings: UnsupportedControl[] = [];
  const rawBase = input.basePrompt ?? "";
  const section = /(?:^|\n)(overall_soundscape|non_diegetic_music):\s*/g;
  const headers = [...rawBase.matchAll(section)];
  if (new Set(headers.map((h) => h[1])).size !== headers.length)
    throw new Error("Duplicate sound/score fields in the base prompt require review.");
  const existing: Record<string, string> = {};
  headers.forEach((h, i) => {
    existing[h[1]] = rawBase
      .slice(h.index! + h[0].length, headers[i + 1]?.index ?? rawBase.length)
      .trim();
  });
  const base = headers.length ? rawBase.slice(0, headers[0].index).trimEnd() : rawBase;
  const soundscape = input.overallSoundscape ?? existing.overall_soundscape;
  const music = input.music ?? existing.non_diegetic_music;
  const contexts = [base, soundscape ?? "", music ?? ""];
  for (const line of input.lines) {
    if (!line.cinematic)
      throw new Error("Save a fresh Cueboard version to use the versioned engine serializer.");
    const speaker = input.speakers[line.character_id];
    if (!speaker) throw new Error("Missing explicit speaker identity.");
    const nonSpeech = [...contexts, line.cinematic.action, line.cinematic.delivery, speaker.label];
    if (line.spoken_text && nonSpeech.some((text) => text.includes(line.spoken_text)))
      throw new Error(
        "Protected dialogue also appears in directions. Remove the duplicate from directions before serialization.",
      );
    if (
      input.profile === "h3-ref2va-1" &&
      [line.spoken_text, ...nonSpeech].some((text) => /<\/?d\b|\[English\]/i.test(text))
    )
      throw new Error(
        "Speech markup in source text cannot be represented safely by this H3 profile.",
      );
    if (line.performance_json.resolved_beats.length)
      findings.push({
        control: "timed_beats",
        status: "unsupported",
        reason:
          "This text profile cannot guarantee timed beat execution; use the diagnostic beat plan for review.",
      });
    if (line.sound_events.length)
      findings.push({
        control: "authored_sound_events",
        status: "unsupported",
        reason: "Source-bound sound execution is not enabled in the production path.",
      });
    findings.push(...line.unsupported_controls);
  }
  const action = input.lines
    .map((line) => {
      const speaker = input.speakers[line.character_id];
      const identity = [
        speaker.label,
        speaker.imageTag && `visual identity ${speaker.imageTag}`,
        speaker.audioTag && `voice identity ${speaker.audioTag}`,
      ]
        .filter(Boolean)
        .join(", ");
      const performance =
        `${identity}. ${line.cinematic!.action} ${line.cinematic!.delivery}`.trim();
      if (!line.spoken_text) return `${performance} The character remains silent.`;
      if (input.profile === "ltx-prose-1")
        return `${performance} ${speaker.label} says: “${line.spoken_text}”`;
      const language = speaker.language ?? "English";
      if (!/^[\p{L} -]+$/u.test(language)) throw new Error("Unsupported speech language tag.");
      return `${performance} ${speaker.label} speaks: <d>[${language}] ${line.spoken_text}</d>`;
    })
    .join("\n\n");
  const fields = {
    prompt: [
      base,
      action,
      "Only the authorized lines are spoken. No additional dialogue or narration.",
    ]
      .filter(Boolean)
      .join("\n\n"),
    overall_soundscape: soundscape?.trim() || "Only authorized dialogue; no invented vocal events.",
    non_diegetic_music: music?.trim() || "N/A",
  };
  return {
    profile: input.profile,
    fields,
    text:
      input.profile === "h3-ref2va-1"
        ? `${fields.prompt}\n\noverall_soundscape: ${fields.overall_soundscape}\nnon_diegetic_music: ${fields.non_diegetic_music}`
        : `${fields.prompt}\n\n${fields.overall_soundscape}${fields.non_diegetic_music === "N/A" ? " No score." : ` Score: ${fields.non_diegetic_music}`}`,
    unsupported_controls: findings,
  };
}
