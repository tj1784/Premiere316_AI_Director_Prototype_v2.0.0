export type ScreenplayNodeKind = "act" | "sequence" | "chapter" | "scene" | "beat" | "dialogue";

export type ScreenplayNode = {
  id: string;
  kind: ScreenplayNodeKind;
  parentId: string | null;
  title: string;
  slugline?: string;
  fountain: string;
  order: number;
  /** Exact UTF-16 source offsets in the original Fountain string. Scoped rewrites splice these spans only. */
  sourceStart: number;
  sourceEnd: number;
  tombstoned?: boolean;
};

export type ScreenplayHierarchy = {
  schemaVersion: 1;
  nodes: ScreenplayNode[];
};

type Line = { text: string; start: number; end: number; contentEnd: number };

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function nextHumanId(kind: ScreenplayNodeKind, used: Set<string>, sceneNumber?: number, beatNumber?: number): string {
  if (kind === "act") {
    let n = 1;
    while (used.has(`ACT-${pad(n, 2)}`)) n += 1;
    return `ACT-${pad(n, 2)}`;
  }
  if (kind === "sequence" || kind === "chapter") {
    let n = 1;
    const prefix = kind === "chapter" ? "CH" : "SEQ";
    while (used.has(`${prefix}-${pad(n, 2)}`)) n += 1;
    return `${prefix}-${pad(n, 2)}`;
  }
  if (kind === "scene") {
    let n = 1;
    while (used.has(`SCENE-${pad(n, 3)}`)) n += 1;
    return `SCENE-${pad(n, 3)}`;
  }
  const scene = pad(sceneNumber ?? 1, 3);
  let n = beatNumber ?? 1;
  while (used.has(`BEAT-${scene}-${pad(n, 2)}`)) n += 1;
  return `BEAT-${scene}-${pad(n, 2)}`;
}

function isSceneHeading(line: string): boolean {
  // Fountain also permits forced headings such as .END CREDITS OVER BLACK.
  // An ellipsis is action, not a forced heading.
  return /^(INT\.|EXT\.|INT\.\/EXT\.|INT\/EXT\.|I\/E\.|EST\.)/i.test(line) || /^\.[^\s.]/.test(line);
}

function explicitSceneId(line: string): string | null {
  const label = line.match(/\s+#([A-Za-z0-9][A-Za-z0-9_.-]*)#\s*$/)?.[1];
  return label ? (/^\d+$/.test(label) ? `SCENE-${pad(Number(label), 3)}` : label) : null;
}

function isActHeading(line: string): boolean {
  return /^ACT\s+/i.test(line);
}

function isSequenceHeading(line: string): boolean {
  return /^(SEQUENCE|SEQ)\s+/i.test(line);
}

function isChapterHeading(line: string): boolean {
  return /^CHAPTER\s+/i.test(line);
}

function splitLinesWithOffsets(fountain: string): Line[] {
  const lines: Line[] = [];
  const pattern = /.*(?:\r\n|\n|\r|$)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(fountain))) {
    const raw = match[0];
    if (!raw && match.index === fountain.length) break;
    const eol = raw.match(/\r\n|\n|\r$/)?.[0] ?? "";
    lines.push({ text: raw.slice(0, raw.length - eol.length), start: match.index, end: match.index + raw.length, contentEnd: match.index + raw.length - eol.length });
    if (match.index + raw.length >= fountain.length) break;
  }
  if (!lines.length) lines.push({ text: "", start: 0, end: 0, contentEnd: 0 });
  return lines;
}

function matchPrevious(previous: ScreenplayHierarchy | null | undefined, kind: ScreenplayNodeKind, order: number, parentId: string | null): ScreenplayNode | null {
  if (!previous) return null;
  return previous.nodes.find((node) => node.kind === kind && node.order === order && node.parentId === parentId && !node.tombstoned) ?? null;
}

function makeNode(input: Omit<ScreenplayNode, "sourceStart" | "sourceEnd"> & Partial<Pick<ScreenplayNode, "sourceStart" | "sourceEnd">>): ScreenplayNode {
  return { sourceStart: input.sourceStart ?? 0, sourceEnd: input.sourceEnd ?? input.sourceStart ?? 0, ...input };
}

function addBeatAndDialogueNodes(nodes: ScreenplayNode[], scene: ScreenplayNode, previous: ScreenplayHierarchy | null | undefined, used: Set<string>) {
  const sceneNumber = Number(scene.id.replace(/^SCENE-/, "")) || scene.order + 1;
  const sceneText = scene.fountain;
  const lineMatches = [...sceneText.matchAll(/.*(?:\r\n|\n|\r|$)/g)].filter((match) => match[0] || match.index < sceneText.length);
  const headingEnd = lineMatches[0] ? scene.sourceStart + (lineMatches[0].index ?? 0) + lineMatches[0][0].length : scene.sourceStart;
  const bodyStart = headingEnd;
  const body = sceneText.slice(bodyStart - scene.sourceStart);
  const paragraphPattern = /\S[\s\S]*?(?=(?:\r\n|\n|\r){2,}|$)/g;
  let beatOrder = 0;
  let paragraph: RegExpExecArray | null;
  while ((paragraph = paragraphPattern.exec(body))) {
    const chunk = paragraph[0];
    if (!chunk.trim()) continue;
    const absoluteStart = bodyStart + paragraph.index;
    const absoluteEnd = absoluteStart + chunk.length;
    const first = chunk.split(/\r\n|\n|\r/)[0]?.trim() ?? "";
    const reused = matchPrevious(previous, "beat", beatOrder, scene.id);
    const beatId = reused?.id ?? nextHumanId("beat", used, sceneNumber, beatOrder + 1);
    used.add(beatId);
    nodes.push(makeNode({
      id: beatId,
      kind: "beat",
      parentId: scene.id,
      title: (first || `Beat ${beatOrder + 1}`).slice(0, 80),
      fountain: chunk,
      order: beatOrder,
      sourceStart: absoluteStart,
      sourceEnd: absoluteEnd,
    }));
    beatOrder += 1;
  }

  const dialoguePattern = /(^|(?:\r\n|\n|\r){2,})([A-Z][A-Z0-9 .'\-]{1,36})(?:\r\n|\n|\r)([\s\S]*?)(?=(?:\r\n|\n|\r){2,}|$)/g;
  let dialogueOrder = 0;
  let dialogue: RegExpExecArray | null;
  while ((dialogue = dialoguePattern.exec(sceneText))) {
    const cue = dialogue[2]?.trim() ?? "";
    if (!cue || isSceneHeading(cue) || isActHeading(cue) || isSequenceHeading(cue) || isChapterHeading(cue)) continue;
    const prefixLength = dialogue[1]?.length ?? 0;
    const start = scene.sourceStart + dialogue.index + prefixLength;
    const end = scene.sourceStart + dialogue.index + dialogue[0].length;
    const reused = matchPrevious(previous, "dialogue", dialogueOrder, scene.id);
    const id = reused?.id ?? `DIALOGUE-${pad(sceneNumber, 3)}-${pad(dialogueOrder + 1, 2)}`;
    used.add(id);
    nodes.push(makeNode({ id, kind: "dialogue", parentId: scene.id, title: cue, fountain: sceneText.slice(start - scene.sourceStart, end - scene.sourceStart), order: dialogueOrder, sourceStart: start, sourceEnd: end }));
    dialogueOrder += 1;
  }
}

export function parseScreenplayHierarchy(fountain: string, previous?: ScreenplayHierarchy | null): ScreenplayHierarchy {
  const lines = splitLinesWithOffsets(fountain);
  const nodes: ScreenplayNode[] = [];
  const used = new Set((previous?.nodes ?? []).map((node) => node.id));
  // Reserve author-supplied IDs so unnumbered scenes cannot consume them first.
  for (const line of lines) {
    if (!isSceneHeading(line.text.trim())) continue;
    const declared = explicitSceneId(line.text.trim());
    if (declared) used.add(declared);
  }
  let actOrder = -1;
  let sequenceOrder = -1;
  let sceneOrder = -1;
  let actId: string | null = null;
  let sequenceId: string | null = null;
  let currentScene: ScreenplayNode | null = null;
  let currentAct: ScreenplayNode | null = null;
  let currentSequence: ScreenplayNode | null = null;

  const closeSequence = (end: number) => {
    if (currentSequence) currentSequence.sourceEnd = end;
    currentSequence = null;
    sequenceId = null;
  };
  const closeAct = (end: number) => {
    closeSequence(end);
    if (currentAct) currentAct.sourceEnd = end;
    currentAct = null;
    actId = null;
  };
  const protectedTrailingLine = (line: string) => /^(?:[A-Z0-9 .'-]+ TO:|FADE (?:IN|OUT):|DISSOLVE TO:|CUT TO:|>.*|\/\/.*|#.*)$/i.test(line.trim());
  const sceneContentEnd = (start: number, end: number) => {
    let adjusted = end;
    while (adjusted > start) {
      const chunk = fountain.slice(start, adjusted);
      const match = chunk.match(/((?:\r\n|\n|\r){2,})([^\r\n]+)((?:\r\n|\n|\r)*)$/);
      if (!match || !protectedTrailingLine(match[2] ?? "")) break;
      adjusted -= match[0].length;
    }
    return adjusted;
  };
  const closeScene = (end: number) => {
    if (!currentScene) return;
    currentScene.sourceEnd = sceneContentEnd(currentScene.sourceStart, end);
    currentScene.fountain = fountain.slice(currentScene.sourceStart, currentScene.sourceEnd);
    addBeatAndDialogueNodes(nodes, currentScene, previous, used);
    currentScene = null;
  };
  const ensureAct = (offset: number) => {
    if (actId) return actId;
    actOrder = Math.max(actOrder, 0);
    const reused = matchPrevious(previous, "act", 0, null);
    actId = reused?.id ?? nextHumanId("act", used);
    used.add(actId);
    currentAct = makeNode({ id: actId, kind: "act", parentId: null, title: reused?.title ?? "Act 1", fountain: "", order: 0, sourceStart: offset, sourceEnd: offset });
    nodes.push(currentAct);
    return actId;
  };

  for (const lineInfo of lines) {
    const line = lineInfo.text.trim();
    if (isActHeading(line)) {
      closeScene(lineInfo.start);
      closeAct(lineInfo.start);
      actOrder += 1;
      sequenceOrder = -1;
      const reused = matchPrevious(previous, "act", actOrder, null);
      actId = reused?.id ?? nextHumanId("act", used);
      used.add(actId);
      currentAct = makeNode({ id: actId, kind: "act", parentId: null, title: line || `Act ${actOrder + 1}`, fountain: lineInfo.text, order: actOrder, sourceStart: lineInfo.start, sourceEnd: fountain.length });
      nodes.push(currentAct);
      continue;
    }
    if (isSequenceHeading(line) || isChapterHeading(line)) {
      closeScene(lineInfo.start);
      closeSequence(lineInfo.start);
      const kind: ScreenplayNodeKind = isChapterHeading(line) ? "chapter" : "sequence";
      sequenceOrder += 1;
      const parent = ensureAct(lineInfo.start);
      const reused = matchPrevious(previous, kind, sequenceOrder, parent);
      sequenceId = reused?.id ?? nextHumanId(kind, used);
      used.add(sequenceId);
      currentSequence = makeNode({ id: sequenceId, kind, parentId: parent, title: line, fountain: lineInfo.text, order: sequenceOrder, sourceStart: lineInfo.start, sourceEnd: fountain.length });
      nodes.push(currentSequence);
      continue;
    }
    if (isSceneHeading(line)) {
      closeScene(lineInfo.start);
      sceneOrder += 1;
      const parent = sequenceId ?? ensureAct(lineInfo.start);
      const reused = matchPrevious(previous, "scene", sceneOrder, parent) ?? matchPrevious(previous, "scene", sceneOrder, previous?.nodes.find((node) => node.kind === "scene" && node.order === sceneOrder)?.parentId ?? parent);
      const declared = explicitSceneId(line);
      const available = (id: string | undefined | null) => id && !nodes.some((node) => node.id === id);
      const sceneId = (available(declared) ? declared : available(reused?.id) ? reused!.id : nextHumanId("scene", used))!;
      used.add(sceneId);
      currentScene = makeNode({ id: sceneId, kind: "scene", parentId: parent, title: line, slugline: line, fountain: "", order: sceneOrder, sourceStart: lineInfo.start, sourceEnd: fountain.length });
      nodes.push(currentScene);
    }
  }
  closeScene(fountain.length);
  if (currentSequence) currentSequence.sourceEnd = fountain.length;
  if (currentAct) currentAct.sourceEnd = fountain.length;
  if (!nodes.some((node) => node.kind === "act")) ensureAct(0);

  for (const node of nodes) {
    if ((node.kind === "act" || node.kind === "sequence" || node.kind === "chapter") && !node.fountain) node.fountain = fountain.slice(node.sourceStart, node.sourceEnd);
  }
  if (previous) {
    for (const node of previous.nodes) {
      if (!nodes.some((item) => item.id === node.id)) nodes.push({ ...node, tombstoned: true });
    }
  }
  return { schemaVersion: 1, nodes };
}

export function sceneNodes(hierarchy: ScreenplayHierarchy): ScreenplayNode[] {
  return hierarchy.nodes.filter((node) => node.kind === "scene" && !node.tombstoned);
}

export function nodeById(hierarchy: ScreenplayHierarchy, id: string | null | undefined): ScreenplayNode | null {
  if (!id) return null;
  return hierarchy.nodes.find((node) => node.id === id && !node.tombstoned) ?? null;
}

export function rebuildFountain(hierarchy: ScreenplayHierarchy): string {
  return sceneNodes(hierarchy).sort((left, right) => left.order - right.order).map((scene) => scene.fountain.trimEnd()).filter(Boolean).join("\n\n");
}

export function extractDialogue(fountain: string): string {
  return parseScreenplayHierarchy(fountain).nodes.filter((node) => node.kind === "dialogue" && !node.tombstoned).map((node) => node.fountain).join("\n\n");
}

export function spliceDialogue(fountain: string, replacement: string): string {
  const hierarchy = parseScreenplayHierarchy(fountain);
  const spans = hierarchy.nodes.filter((node) => node.kind === "dialogue" && !node.tombstoned).map((node) => ({ start: node.sourceStart, end: node.sourceEnd, replacement })).sort((a, b) => b.start - a.start);
  return applySourceReplacements(fountain, spans);
}

export function applySourceReplacements(fountain: string, spans: { start: number; end: number; replacement: string }[]): string {
  let next = fountain;
  for (const span of [...spans].sort((left, right) => right.start - left.start)) {
    if (span.start < 0 || span.end < span.start || span.end > fountain.length) continue;
    next = `${next.slice(0, span.start)}${span.replacement}${next.slice(span.end)}`;
  }
  return next;
}

export function previousAndNextSceneSummaries(hierarchy: ScreenplayHierarchy, sceneId: string): { previous: string; next: string } {
  const scenes = sceneNodes(hierarchy).sort((a, b) => a.order - b.order);
  const index = scenes.findIndex((scene) => scene.id === sceneId);
  const summary = (node: ScreenplayNode | undefined) => node ? node.fountain.split(/\r\n|\n|\r/).slice(0, 4).join(" ").slice(0, 280) : "";
  return { previous: summary(scenes[index - 1]), next: summary(scenes[index + 1]) };
}
