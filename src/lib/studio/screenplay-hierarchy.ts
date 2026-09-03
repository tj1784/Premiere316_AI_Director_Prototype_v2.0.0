export type ScreenplayNodeKind = "act" | "sequence" | "scene" | "beat";

export type ScreenplayNode = {
  id: string;
  kind: ScreenplayNodeKind;
  parentId: string | null;
  title: string;
  slugline?: string;
  fountain: string;
  order: number;
};

export type ScreenplayHierarchy = {
  schemaVersion: 1;
  nodes: ScreenplayNode[];
};

function slugId(prefix: string, value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  return `${prefix}:${slug || "untitled"}`;
}

export function parseScreenplayHierarchy(fountain: string): ScreenplayHierarchy {
  const lines = fountain.replace(/\r\n/g, "\n").split("\n");
  const nodes: ScreenplayNode[] = [];
  let actId = "act:1";
  let actCount = 0;
  let sceneOrder = 0;
  let currentScene: ScreenplayNode | null = null;
  let buffer: string[] = [];

  const flushScene = () => {
    if (!currentScene) return;
    currentScene.fountain = buffer.join("\n").replace(/\n+$/, "");
    const body = currentScene.fountain.split(/\n{2,}/).map((chunk) => chunk.trim()).filter(Boolean);
    body.forEach((chunk, index) => {
      if (/^(INT\.|EXT\.|INT\.\/EXT\.|I\/E\.)/i.test(chunk.split("\n")[0] ?? "")) return;
      nodes.push({
        id: slugId(`beat:${currentScene!.id}`, chunk.split("\n")[0] ?? String(index)),
        kind: "beat",
        parentId: currentScene!.id,
        title: (chunk.split("\n")[0] ?? `Beat ${index + 1}`).slice(0, 80),
        fountain: chunk,
        order: index,
      });
    });
    buffer = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (/^ACT\s+/i.test(line)) {
      flushScene();
      currentScene = null;
      actCount += 1;
      actId = slugId("act", line || String(actCount));
      nodes.push({ id: actId, kind: "act", parentId: null, title: line || `Act ${actCount}`, fountain: line, order: actCount - 1 });
      continue;
    }
    if (/^(INT\.|EXT\.|INT\.\/EXT\.|I\/E\.)/i.test(line)) {
      flushScene();
      sceneOrder += 1;
      const sceneId = slugId("scene", line);
      currentScene = {
        id: sceneId,
        kind: "scene",
        parentId: actId,
        title: line,
        slugline: line,
        fountain: "",
        order: sceneOrder - 1,
      };
      nodes.push(currentScene);
      if (!nodes.some((node) => node.id === actId)) {
        nodes.unshift({ id: actId, kind: "act", parentId: null, title: "Act 1", fountain: "", order: 0 });
      }
      buffer = [raw];
      continue;
    }
    buffer.push(raw);
  }
  flushScene();
  if (!nodes.some((node) => node.kind === "act")) {
    nodes.unshift({ id: actId, kind: "act", parentId: null, title: "Act 1", fountain: "", order: 0 });
  }
  return { schemaVersion: 1, nodes };
}

export function sceneNodes(hierarchy: ScreenplayHierarchy): ScreenplayNode[] {
  return hierarchy.nodes.filter((node) => node.kind === "scene");
}

export function nodeById(hierarchy: ScreenplayHierarchy, id: string | null | undefined): ScreenplayNode | null {
  return hierarchy.nodes.find((node) => node.id === id) ?? null;
}

export function rebuildFountain(hierarchy: ScreenplayHierarchy): string {
  return sceneNodes(hierarchy)
    .sort((left, right) => left.order - right.order)
    .map((scene) => scene.fountain.trimEnd())
    .filter(Boolean)
    .join("\n\n");
}
