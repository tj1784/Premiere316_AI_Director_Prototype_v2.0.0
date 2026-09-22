import { useState } from "react";
import { Button } from "@/components/ui/button";
import { compileEnginePromptPackage } from "@/lib/studio/prompt-compiler";
import type { Picture } from "@/lib/studio/types";
import { useWorkspaceDraft } from "./use-workspace-draft";
import { copyText, readyTextFile, saveReadyFile } from "@/lib/utils";
import { toast } from "sonner";

export function PromptPayloadPreview({ picture }: { picture: Picture }) {
  const [shotId, setShotId] = useWorkspaceDraft("prompt-preview-shot", "");
  const [target, setTarget] = useWorkspaceDraft<"still" | "video">(
    "prompt-preview-target",
    "video",
  );
  const [copied, setCopied] = useState(false);
  const shot = picture.shots.find((s) => s.id === shotId) ?? picture.shots[0];
  let compiled: ReturnType<typeof compileEnginePromptPackage> | undefined;
  let error = "";
  try {
    if (shot) compiled = compileEnginePromptPackage({ picture, shot, target });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  return (
    <section className="grid gap-4" aria-label="Selected engine payload">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid flex-1 gap-2 text-sm">
          Shot
          <select
            aria-label="Payload shot"
            className="min-h-11 w-full rounded border border-border bg-inset px-3"
            value={shot?.id ?? ""}
            onChange={(e) => {
              setShotId(e.target.value);
              setCopied(false);
            }}
          >
            {!shot && <option value="">No shots prepared</option>}
            {picture.shots.map((s) => (
              <option key={s.id} value={s.id}>
                {s.index} · {s.description}
              </option>
            ))}
          </select>
        </label>
        <div className="workspace-tabs" aria-label="Payload media type">
          <button
            aria-pressed={target === "still"}
            onClick={() => {
              setTarget("still");
              setCopied(false);
            }}
          >
            Still
          </button>
          <button
            aria-pressed={target === "video"}
            onClick={() => {
              setTarget("video");
              setCopied(false);
            }}
          >
            Video
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-rec">
          {error}
        </p>
      )}
      {compiled ? (
        <>
          <header>
            <p className="workspace-eyebrow">COMPILED ENGINE PROMPT · {compiled.engineTarget}</p>
            <h3 className="mt-2 font-display text-xl">{shot?.description}</h3>
          </header>
          <pre className="min-h-64 whitespace-pre-wrap break-words rounded-lg border border-border bg-inset p-5 font-sans text-sm leading-relaxed">
            {compiled.enginePrompt}
          </pre>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={async () => {
                const ok = await copyText(compiled!.enginePrompt);
                setCopied(ok);
                if (!ok) toast.error("Could not copy the prompt.");
              }}
            >
              {copied ? "Copied" : "Copy complete prompt"}
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                void saveReadyFile(
                  readyTextFile(
                    `${shot!.id}-${target}-prompt.txt`,
                    compiled!.enginePrompt,
                    "text/plain",
                  ),
                )
              }
            >
              Export prompt
            </Button>
          </div>
          <details className="rounded border border-border p-3">
            <summary className="cursor-pointer text-sm">
              Execution payload & source bindings
            </summary>
            <pre className="mt-3 overflow-auto whitespace-pre-wrap break-words text-xs text-muted">
              {JSON.stringify(compiled, null, 2)}
            </pre>
          </details>
        </>
      ) : (
        !error && (
          <p className="rounded border border-dashed border-border p-8 text-sm text-muted">
            Prepare a shot to inspect its complete engine prompt and source bindings.
          </p>
        )
      )}
    </section>
  );
}
