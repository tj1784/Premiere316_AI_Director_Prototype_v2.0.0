import { toast } from "sonner";
import { useActivePicture, useStudio } from "@/lib/studio/store";
import {
  RENDER_FIELDS,
  resolveRenderContext,
  saveRenderClause,
  type RenderClause,
  type RenderField,
} from "@/lib/studio/render-context";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { useWorkspaceDraft } from "./use-workspace-draft";

export function RenderContextEditor() {
  const picture = useActivePicture();
  const patch = useStudio((s) => s.patchActive);
  const [scope, setScope] = useWorkspaceDraft<RenderClause["scope"]>(
    "render-description-scope",
    "film",
  );
  const [scopeId, setScopeId] = useWorkspaceDraft("render-description-scope-id", "");
  const [field, setField] = useWorkspaceDraft<RenderField>("render-description-field", "medium");
  const [value, setValue] = useWorkspaceDraft("render-description-value", "");
  const [source, setSource] = useWorkspaceDraft(
    "render-description-source",
    "User creative direction",
  );
  const [shotId, setShotId] = useWorkspaceDraft("render-description-preview-shot", "");
  if (!picture) return null;
  const choices =
    scope === "scene"
      ? picture.scenes.map((s) => ({ id: s.id, label: s.slugline }))
      : picture.shots.map((s) => ({ id: s.id, label: `${s.id} · ${s.description}` }));
  const shot = picture.shots.find((s) => s.id === shotId) ?? picture.shots[0];
  const resolved = shot && resolveRenderContext(picture, shot);
  return (
    <section className="render-context-editor grid gap-3 rounded-lg border border-border bg-surface p-4">
      <h2 className="text-2xl">Global & local render description</h2>
      <p className="text-sm text-muted">
        Only invariant audiovisual properties belong at film scope. Local light, weather and music
        replace the same inherited field; proposals never override approved source.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          Scope
          <select
            className="h-11 w-full rounded border border-border bg-inset px-3"
            value={scope}
            onChange={(e) => {
              setScope(e.target.value as RenderClause["scope"]);
              setScopeId("");
            }}
          >
            <option value="film">Film</option>
            <option value="scene">Scene</option>
            <option value="shot">Shot</option>
          </select>
        </label>
        <label className="text-sm">
          Property
          <select
            className="h-11 w-full rounded border border-border bg-inset px-3"
            value={field}
            onChange={(e) => setField(e.target.value as RenderField)}
          >
            {RENDER_FIELDS.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
      </div>
      {scope !== "film" && (
        <label className="text-sm">
          Source scope
          <select
            className="h-11 w-full rounded border border-border bg-inset px-3"
            value={scopeId}
            onChange={(e) => setScopeId(e.target.value)}
          >
            <option value="">Select {scope}</option>
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <Textarea
        aria-label="Render description value"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Describe this audiovisual property; no cast lists, future actions or dialogue."
      />
      <Input
        aria-label="Governing source or user choice"
        value={source}
        onChange={(e) => setSource(e.target.value)}
      />
      <Button
        onClick={() => {
          try {
            patch({
              renderContext: saveRenderClause(picture, {
                field,
                value,
                scope,
                scopeId: scope === "film" ? picture.id : scopeId,
                sourceId: source,
                sourceRevision: String(Date.now()),
                authority: "user",
              }),
            });
            toast.success("Scoped render direction saved.");
          } catch (error) {
            toast.error(String(error));
          }
        }}
      >
        Save scoped description
      </Button>
      <div className="grid gap-2">
        {picture.renderContext?.clauses.map((c) => (
          <div key={c.id} className="rounded border border-border p-3 text-sm">
            <p>
              {c.scope} · {c.field} · revision {c.revision}
            </p>
            <p className="whitespace-pre-wrap text-muted">{c.value}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setScope(c.scope);
                setScopeId(c.scopeId);
                setField(c.field);
                setValue(c.value);
                setSource(c.sourceId);
              }}
            >
              Edit
            </Button>
          </div>
        ))}
      </div>
      {resolved && (
        <details>
          <summary className="min-h-11 cursor-pointer py-3 text-sm">
            Resolved preview & source trace
          </summary>
          <select
            aria-label="Preview shot"
            className="h-11 w-full bg-inset"
            value={shot.id}
            onChange={(e) => setShotId(e.target.value)}
          >
            {picture.shots.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id}
              </option>
            ))}
          </select>
          <pre className="whitespace-pre-wrap break-words py-3 text-sm">
            {resolved.global}
            {"\n"}
            {resolved.local}
          </pre>
          {resolved.issues.map((issue) => (
            <p key={issue} role="alert" className="text-sm text-rec">
              {issue}
            </p>
          ))}
          <p className="text-xs text-muted">
            {resolved.effective
              .map((c) => `${c.field} ← ${c.sourceId} @ ${c.sourceRevision}`)
              .join(" · ")}
          </p>
          <p className="text-xs text-muted">
            {resolved.withheld.length} superseded/proposed clauses withheld. No media quality
            approval is implied.
          </p>
        </details>
      )}
    </section>
  );
}
