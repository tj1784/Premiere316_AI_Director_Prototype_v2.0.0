import { engineById, ENGINES } from "./engines";
import { fountainFrom, shotStarts } from "./prompt-compiler";
import { MODEL_ROOT, type Picture } from "./types";
import { readyTextFile, type ReadyFile, formatTimecode } from "../utils";

export function buildFountain(picture: Picture): ReadyFile {
  return readyTextFile(
    `${slug(picture.title)}.fountain`,
    picture.screenplayFountain || fountainFrom(picture),
  );
}

export function buildShotList(picture: Picture): ReadyFile {
  const starts = shotStarts(picture);
  const header = "shot,scene,type,start,end,dur,camera,emotion,t2i,i2v";
  const rows = picture.shots.map((s) => {
    const span = starts.find((x) => x.id === s.id);
    const scene = picture.scenes.find((sc) => sc.id === s.sceneId);
    const cells = [
      s.id,
      scene?.slugline ?? "",
      s.type,
      formatTimecode(span?.start ?? 0, picture.fps),
      formatTimecode(span?.end ?? 0, picture.fps),
      String(s.durationSec),
      s.cameraMove,
      s.emotion,
      quote(s.t2iPrompt),
      quote(s.i2vPrompt),
    ];
    return cells.join(",");
  });
  return readyTextFile(`${slug(picture.title)}-shots.csv`, [header, ...rows].join("\n"), "text/csv");
}

export function buildEdl(picture: Picture): ReadyFile {
  const starts = shotStarts(picture);
  const lines = [`TITLE: ${picture.title}`, "FCM: NON-DROP FRAME", ""];
  picture.shots.forEach((s, i) => {
    const span = starts.find((x) => x.id === s.id)!;
    const recIn = formatTimecode(span.start, picture.fps);
    const recOut = formatTimecode(span.end, picture.fps);
    const srcOut = formatTimecode(s.durationSec, picture.fps);
    lines.push(
      `${String(i + 1).padStart(3, "0")}  AX       V     C        00:00:00:00 ${srcOut} ${recIn} ${recOut}`,
      `* FROM CLIP NAME: ${s.id} ${s.description}`,
      "",
    );
  });
  return readyTextFile(`${slug(picture.title)}.edl`, lines.join("\n"));
}

export function buildCueSheet(picture: Picture): ReadyFile {
  const body = picture.cues
    .map(
      (c) =>
        `${c.name}\n  ${formatTimecode(c.startSec)}–${formatTimecode(c.startSec + c.durationSec)}  ${c.durationSec}s\n  ${c.mood}\n  ${c.instruments}\n  Music3: ${c.minimaxPrompt}\n  SFX: ${c.sfx}\n`,
    )
    .join("\n");
  return readyTextFile(`${slug(picture.title)}-cues.txt`, `CUE SHEET — ${picture.title}\n\n${body}`);
}

export function buildPromptPack(picture: Picture): ReadyFile {
  const image = engineById(picture.selectedEngine.image)?.name ?? picture.selectedEngine.image;
  const video = engineById(picture.selectedEngine.video)?.name ?? picture.selectedEngine.video;
  const parts = picture.shots.map((s) =>
    [
      `## ${s.id}  ${s.type}  ${s.durationSec}s`,
      s.description,
      "",
      `T2I [${image}]`,
      s.t2iPrompt,
      "",
      `I2V [${video}]`,
      s.i2vPrompt,
      "",
      s.t2voicePrompt ? `VOICE\n${s.t2voicePrompt}\n` : "",
    ].join("\n"),
  );
  return readyTextFile(
    `${slug(picture.title)}-prompts.md`,
    `# Prompt pack — ${picture.title}\n\n${parts.join("\n---\n\n")}`,
  );
}

export function buildProjectJson(picture: Picture): ReadyFile {
  return readyTextFile(
    `${slug(picture.title)}.premiere316.json`,
    JSON.stringify(
      {
        app: "Premiere316",
        version: "3.02",
        modelRoot: MODEL_ROOT,
        engines: ENGINES.map((e) => ({ id: e.id, repo: `${e.org}/${e.repo}` })),
        picture,
      },
      null,
      2,
    ),
    "application/json",
  );
}

export function buildAllExports(picture: Picture): ReadyFile[] {
  return [
    buildFountain(picture),
    buildShotList(picture),
    buildEdl(picture),
    buildPromptPack(picture),
    buildCueSheet(picture),
    buildProjectJson(picture),
  ];
}

function slug(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "picture";
}

function quote(s: string) {
  return `"${s.replaceAll('"', '""')}"`;
}
