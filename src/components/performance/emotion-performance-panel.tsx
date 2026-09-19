import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useStudio } from "@/lib/studio/store";
import type { Picture } from "@/lib/studio/types";
import type { Catalog, SceneConfig } from "@/lib/emotion/types";
import {
  approvedPerformanceSource,
  performanceReviewPicture,
  emptyEmotionWorkspace,
  makePerformanceDraft,
  applyPerformanceDrafts,
  isPerformanceDraftStale,
  undoPerformanceDraft,
  sceneTemplate,
  performanceSourceKey,
} from "@/lib/emotion/integration";
import { CueboardSettingsEditor } from "./cueboard-settings-editor";
import { serializePerformance } from "@/lib/emotion/serializers";
import { reviewEmotionScene } from "@/lib/emotion/review-api";
import { BrowserEndpointCache } from "@/lib/studio/local-llm-endpoint";
import { JointPerformanceWorkflow } from "./joint-performance-workflow";

export function EmotionPerformancePanel({ picture }: { picture: Picture }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState<string | null>(null),
    [text, setText] = useState("");
  const [error, setError] = useState("");
  const [editSource, setEditSource] = useState("");
  const [manualScene, setManualScene] = useState("");
  let editConfig: SceneConfig | null = null;
  try {
    if (editing) editConfig = JSON.parse(text);
  } catch {
    /* Expert JSON stays editable while incomplete. */
  }
  useEffect(() => {
    let alive = true;
    fetch("/data/emotion_catalog.json")
      .then((r) => {
        if (!r.ok) throw new Error("Emotion catalogue is unavailable.");
        return r.json();
      })
      .then((c) => {
        if (alive) setCatalog(c);
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, []);
  const state = picture.emotionPerformance ?? emptyEmotionWorkspace();
  const scenes = approvedPerformanceSource(picture).hierarchy.nodes.filter(
    (n) => n.kind === "scene",
  );
  const latest = () => {
    const p = useStudio.getState().pictures.find((p) => p.id === picture.id);
    if (!p) throw new Error("Picture is unavailable.");
    return p;
  };
  const save = (p: Picture) => useStudio.getState().replaceActive({ ...p, updatedAt: Date.now() });
  const execute = (fn: () => void) => {
    try {
      fn();
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  async function review() {
    setBusy(true);
    setError("");
    try {
      for (const sceneId of selected) {
        const captured = latest();
        const capturedDrafts = JSON.stringify(
          captured.emotionPerformance ?? emptyEmotionWorkspace(),
        );
        const draft = await reviewEmotionScene({
          data: {
            picture: performanceReviewPicture(captured),
            sceneId,
            endpoint: new BrowserEndpointCache().get(),
          },
        });
        const current = latest();
        if (
          JSON.stringify(current.emotionPerformance ?? emptyEmotionWorkspace()) !== capturedDrafts
        )
          throw new Error(
            "Performance versions changed during review. The late proposal was discarded.",
          );
        if (isPerformanceDraftStale(current, draft))
          throw new Error("Source changed during review. Request a fresh proposal.");
        const existing = current.emotionPerformance ?? emptyEmotionWorkspace();
        save({
          ...current,
          emotionPerformance: { ...existing, drafts: [...existing.drafts, draft] },
        });
      }
      toast.success("Performance proposals are ready for review.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="shrink-0 border-b border-border bg-panel px-4 py-3">
      <summary className="cursor-pointer text-sm font-medium">
        Cueboard · AI performance proposals{" "}
        <span className="ml-2 text-xs text-muted">{state.drafts.length} saved versions</span>
      </summary>
      <div className="max-h-[65vh] space-y-4 overflow-y-auto pt-4">
        <p className="max-w-3xl text-sm text-muted">
          Review the approved screenplay with your configured writer. Internal emotion, outward
          expression and vocal delivery remain editable. Applying a draft approves its performance
          directions; generation still requires a compatible, reviewed workflow and explicit
          reference connections.
        </p>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={!catalog || selected.length !== 1}
            onClick={() =>
              execute(() => {
                const p = latest();
                const sceneId = selected[0];
                setManualScene(sceneId);
                setEditing("new");
                setEditSource(performanceSourceKey(p, sceneId));
                setText(JSON.stringify(sceneTemplate(p, sceneId, catalog!), null, 2));
              })
            }
          >
            Create manual draft for selected scene
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setSelected(scenes.map((s) => s.id))}
          >
            Select all scenes
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setSelected([])}>
            Clear selection
          </Button>
          <Button
            size="sm"
            disabled={busy || !catalog || !selected.length}
            onClick={() => void review()}
          >
            {busy ? "Reviewing scene context…" : "AI review selected scenes"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || !selected.length}
            onClick={() =>
              execute(() => {
                const p = latest(),
                  s = p.emotionPerformance ?? emptyEmotionWorkspace();
                const ids = selected.map((sceneId) => {
                  const draft = s.drafts.filter((d) => d.sceneId === sceneId).at(-1);
                  if (!draft) throw new Error(`Review ${sceneId} first.`);
                  return draft.id;
                });
                save({ ...p, emotionPerformance: applyPerformanceDrafts(p, ids) });
              })
            }
          >
            Apply latest selected proposals
          </Button>
        </div>
        {editing === "new" && editConfig && catalog && (
          <div className="space-y-3 rounded border border-border p-3">
            <CueboardSettingsEditor
              config={editConfig}
              catalog={catalog}
              picture={picture}
              sceneId={manualScene}
              onChange={(value) => setText(JSON.stringify(value, null, 2))}
            />
            <Button
              onClick={() =>
                execute(() => {
                  const p = latest();
                  if (performanceSourceKey(p, manualScene) !== editSource)
                    throw new Error("Source changed while editing. Reopen a fresh draft.");
                  const next = makePerformanceDraft(
                    p,
                    catalog,
                    JSON.parse(text),
                    "manual authoring",
                  );
                  const s = p.emotionPerformance ?? emptyEmotionWorkspace();
                  save({ ...p, emotionPerformance: { ...s, drafts: [...s.drafts, next] } });
                  setEditing(null);
                })
              }
            >
              Validate and save manual version
            </Button>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {scenes.map((scene) => (
            <label
              key={scene.id}
              className="flex min-h-11 items-center gap-2 rounded border border-border px-3 text-xs"
            >
              <input
                type="checkbox"
                checked={selected.includes(scene.id)}
                onChange={(e) =>
                  setSelected((s) =>
                    e.target.checked ? [...s, scene.id] : s.filter((id) => id !== scene.id),
                  )
                }
              />
              <span>{scene.title}</span>
            </label>
          ))}
        </div>
        {state.drafts
          .slice()
          .reverse()
          .map((draft) => (
            <article key={draft.id} className="space-y-2 rounded border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm">
                  {scenes.find((s) => s.id === draft.sceneId)?.title ?? draft.sceneId} ·{" "}
                  {new Date(draft.createdAt).toLocaleString()} ·{" "}
                  {isPerformanceDraftStale(picture, draft)
                    ? "Stale — review source changes"
                    : state.applied[draft.sceneId] === draft.id
                      ? "Applied"
                      : "Draft"}
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={isPerformanceDraftStale(picture, draft)}
                    onClick={() => {
                      setEditing(draft.id);
                      setEditSource(draft.source);
                      setText(JSON.stringify(draft.config, null, 2));
                    }}
                  >
                    Edit settings
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={isPerformanceDraftStale(picture, draft)}
                    onClick={() =>
                      execute(() => {
                        const p = latest();
                        save({ ...p, emotionPerformance: applyPerformanceDrafts(p, [draft.id]) });
                      })
                    }
                  >
                    Apply this version
                  </Button>
                  {state.applied[draft.sceneId] === draft.id && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        execute(() => {
                          const p = latest();
                          save({
                            ...p,
                            emotionPerformance: undoPerformanceDraft(p, draft.sceneId),
                          });
                        })
                      }
                    >
                      Unapply
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted">
                Writer: {draft.modelId} · Dialogue and speaker fields are locked. Reapplying an
                earlier version restores that version.
              </p>
              <details>
                <summary className="min-h-11 cursor-pointer text-xs">Diagnostic packet</summary>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-inset p-3 text-xs">
                  {draft.prompt}
                </pre>
              </details>
              <details>
                <summary className="min-h-11 cursor-pointer text-xs">
                  Engine prompt inspection · preview does not grant generation capability
                </summary>
                {(["ltx-prose-1", "h3-ref2va-1"] as const).map((profile) => {
                  try {
                    const result = serializePerformance({
                      profile,
                      lines: draft.compiled,
                      speakers: draft.config.character_baselines,
                    });
                    return (
                      <div key={profile}>
                        <p className="text-xs">{profile}</p>
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap bg-inset p-3 text-xs">
                          {result.text}
                        </pre>
                        <p className="text-xs text-muted">
                          {[
                            ...new Set(
                              result.unsupported_controls.map((f) => `${f.control}: ${f.reason}`),
                            ),
                          ].join(" ")}
                        </p>
                      </div>
                    );
                  } catch (e) {
                    return (
                      <p key={profile} className="text-xs text-muted">
                        {String(e)}
                      </p>
                    );
                  }
                })}
              </details>
              {state.applied[draft.sceneId] && state.applied[draft.sceneId] !== draft.id && (
                <details>
                  <summary className="min-h-11 cursor-pointer text-xs">
                    Compare with applied version
                  </summary>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {[state.drafts.find((d) => d.id === state.applied[draft.sceneId]), draft].map(
                      (version, i) => (
                        <div key={i}>
                          <p className="text-xs">{i === 0 ? "Applied settings" : "This version"}</p>
                          <pre className="max-h-64 overflow-auto whitespace-pre-wrap bg-inset p-3 text-xs">
                            {JSON.stringify(
                              {
                                scene: version?.config.scene_defaults,
                                characters: version?.config.character_overrides,
                                lines: version?.config.lines.map((l) => ({
                                  line: l.line_id,
                                  settings: l.overrides,
                                  beats: l.beats,
                                })),
                              },
                              null,
                              2,
                            )}
                          </pre>
                        </div>
                      ),
                    )}
                  </div>
                </details>
              )}
              {state.applied[draft.sceneId] === draft.id && (
                <JointPerformanceWorkflow picture={picture} draft={draft} />
              )}
              {draft.compiled.flatMap((l) => l.warnings).length > 0 && (
                <p className="text-xs text-muted">
                  {[...new Set(draft.compiled.flatMap((l) => l.warnings))].join(" ")}
                </p>
              )}
              {editing === draft.id && (
                <div className="space-y-2">
                  {editConfig && catalog && (
                    <CueboardSettingsEditor
                      key={draft.id}
                      config={editConfig}
                      catalog={catalog}
                      picture={picture}
                      sceneId={draft.sceneId}
                      onChange={(value) => setText(JSON.stringify(value, null, 2))}
                    />
                  )}
                  <details>
                    <summary className="min-h-11 cursor-pointer text-xs">
                      Expert JSON · same validated schema
                    </summary>
                    <label className="block text-xs">
                      Full settings and timed beat overrides
                      <textarea
                        aria-label="Editable performance settings"
                        className="mt-2 min-h-64 w-full rounded border border-border bg-inset p-3 font-mono text-xs"
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                      />
                    </label>
                  </details>
                  <Button
                    size="sm"
                    onClick={() =>
                      execute(() => {
                        if (!catalog) return;
                        const p = latest();
                        if (performanceSourceKey(p, draft.sceneId) !== editSource)
                          throw new Error("Source changed while editing. Reopen a fresh draft.");
                        const next = makePerformanceDraft(
                          p,
                          catalog,
                          JSON.parse(text),
                          "manual revision",
                        );
                        const s = p.emotionPerformance ?? emptyEmotionWorkspace();
                        save({ ...p, emotionPerformance: { ...s, drafts: [...s.drafts, next] } });
                        setEditing(null);
                      })
                    }
                  >
                    Validate and save new version
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    Cancel edit
                  </Button>
                </div>
              )}
            </article>
          ))}
      </div>
    </details>
  );
}
