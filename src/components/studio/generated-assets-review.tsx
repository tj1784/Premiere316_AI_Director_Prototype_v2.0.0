import { GLOBAL_PRODUCTION_INSTRUCTIONS, getGlobalProductionInstructions, setGlobalProductionInstructions, subscribeGlobalProductionInstructions } from "@/lib/studio/production-instructions";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useStudio } from "@/lib/studio/store";
import type { Picture } from "@/lib/studio/types";
import { generateAssetDrafts, hasCurrentImage, isVisualAsset } from "@/lib/studio/asset-generation-client";
import { engineById } from "@/lib/studio/engines";
import { writeAssetPromptsOnServer, executeMoviePlanOnServer, findAssetReferencesOnServer } from "@/lib/studio/movie-plan-client";
import { assetPromptContext, CHARACTER_IDENTITY_SHEET_CONTRACT } from "@/lib/studio/asset-prompt-context";
import { assetGenerationRuns, type AssetGenerationPhase, type AssetGenerationRun } from "@/lib/studio/asset-generation-runs";
import type { MoviePlanProgress } from "@/lib/studio/movie-plan-stream";
import { ASSET_REVIEW_GROUPS, assetReviewGroup } from "@/lib/studio/asset-review-categories";
import * as Dialog from "@radix-ui/react-dialog";
import { LocalWriterSelect } from "./local-writer-select";
import { AssetReferenceUpload } from "../production/asset-reference-upload";
import { hydrateProductFlow } from "@/lib/studio/product-flow";
import { ImportedPackageResources } from "./imported-package-resources";

const PHASE_LABELS: Record<AssetGenerationPhase, string> = {
  references: "Finding visual references",
  prompts: "Writing asset prompts",
  images: "Generating asset images",
};

function duration(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function AssetRunSummary({ pictureId }: { pictureId: string }) {
  const run = useSyncExternalStore(assetGenerationRuns.subscribe, () => assetGenerationRuns.get(pictureId), () => null);
  if (!run) return null;
  return <div aria-label="Current asset generation status" className="sticky top-0 z-20 grid gap-1 rounded-md border border-accent bg-elevated p-3 shadow-lg">
    <p className="text-sm font-semibold" role="status">{run.status === "running" ? PHASE_LABELS[run.phase] : run.status === "completed" ? "Asset generation completed" : "Asset generation stopped"}</p>
    <p className="text-sm">{run.message}</p>
    {run.counts ? <p className="text-xs text-muted">{run.counts.prompts}/{run.counts.assets} current prompts saved · {run.counts.images} new images saved in this run</p> : null}
  </div>;
}

export function AssetRunActivity({ pictureId }: { pictureId: string }) {
  const run = useSyncExternalStore(assetGenerationRuns.subscribe, () => assetGenerationRuns.get(pictureId), () => null);
  const [now, setNow] = useState(Date.now);
  const running = run?.status === "running";
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running, run?.id]);
  if (!run) return null;
  const failed = run.status === "failed" || run.status === "interrupted";
  const endedAt = run.finishedAt ?? now;
  return <div aria-label="Asset generation activity" className={`mt-4 grid gap-3 rounded-md border p-4 ${failed ? "border-rec" : "border-accent"} bg-inset text-fg`}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h4 className="flex items-center gap-2 font-medium">
        {running ? <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none text-accent" /> : failed ? <AlertCircle aria-hidden className="size-4 text-rec" /> : <CheckCircle2 aria-hidden className="size-4 text-good" />}
        {running ? PHASE_LABELS[run.phase] : failed ? "Generation stopped" : "Generation complete"}
      </h4>
      <span className="text-sm tabular-nums">Elapsed {duration(endedAt - run.startedAt)}</span>
    </div>
    <p role={failed ? "alert" : "status"} className="text-sm font-medium">{run.message}</p>
    {running ? <p className="text-xs text-muted">Current phase {duration(now - run.phaseStartedAt)} · Last update {Math.max(0, Math.floor((now - run.updatedAt) / 1000))}s ago. Progress stays here when you return to Assets.</p> : null}
    {run.counts ? <p className="text-sm">{run.counts.prompts}/{run.counts.assets} current prompts saved · {run.counts.images} new images saved · {run.counts.references} new references attached</p> : null}
    {failed ? <p className="text-sm">Saved prompts, references and images remain available. The error above needs resolving before the remaining work can complete.</p> : null}
    {run.output ? <details open={running && run.phase !== "images"} className="min-w-0 text-sm">
      <summary className="cursor-pointer">{running && run.phase !== "images" ? "Live model output" : "Last model output"} · {run.output.text.length.toLocaleString()} characters</summary>
      <p className="mt-2 break-all text-xs text-muted">{run.output.model}</p>
      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-elevated p-3 text-xs leading-relaxed">{run.output.text || "Waiting for the model’s first output…"}</pre>
    </details> : null}
    {run.output?.reasoning ? <details open={running} className="min-w-0 text-sm"><summary>Local model reasoning reported by LM Studio · {run.output.reasoning.length.toLocaleString()} characters</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-elevated p-3 text-xs">{run.output.reasoning}</pre></details> : null}
    <details open className="min-w-0 text-sm">
      <summary className="cursor-pointer">Activity log</summary>
      <ol className="mt-2 grid max-h-52 gap-2 overflow-auto text-xs">
        {[...run.activity].reverse().map((entry, index) => <li key={`${entry.at}:${index}`} className="flex gap-3"><time className="shrink-0 tabular-nums text-muted" dateTime={new Date(entry.at).toISOString()}>{new Date(entry.at).toLocaleTimeString()}</time><span>{entry.message}</span></li>)}
      </ol>
    </details>
  </div>;
}

export function GeneratedAssetsReview({ picture }: { picture: Picture }) {
  const globalInstructions = useSyncExternalStore(subscribeGlobalProductionInstructions, getGlobalProductionInstructions, () => GLOBAL_PRODUCTION_INSTRUCTIONS);
  const [category, setCategory] = useState<string>("characters");
  const [preview, setPreview] = useState<{ name: string; uri: string } | null>(null);
  const runStatus = useSyncExternalStore(assetGenerationRuns.subscribe, () => assetGenerationRuns.get(picture.id)?.status ?? null, () => null);
  const busy = runStatus === "running";
  const kind = assetGenerationRuns.get(picture.id)?.kind;
  const replaceActive = useStudio((s) => s.replaceActive);
  const assets = picture.production?.assets.filter(isVisualAsset) ?? [];
  const allAssets = picture.production?.assets.filter((asset) => !asset.tombstone) ?? [];
  const imageModelName = picture.selectedEngine.image === "krea-2" ? "KREA2 RAW" : engineById(picture.selectedEngine.image)?.name ?? picture.selectedEngine.image;
  const assetReviews = assets.map((asset) => {
    const source = picture.assetPromptSources?.[asset.id];
    const prompt = picture.assetImagePrompts?.[asset.id] ?? source?.prompt ?? "";
    let sourceCurrent = false;
    try { sourceCurrent = Boolean(source && source.tokenCount >= 1024 && source.tokenCount <= 3500 && source.contextHash === assetPromptContext(picture, asset).hash); }
    catch { /* Missing scene is shown as unavailable below. */ }
    const iterations = [...asset.iterations].reverse();
    const current = sourceCurrent ? iterations.find((iteration) => hasCurrentImage({ ...asset, iterations: [iteration] }, picture.selectedEngine.image, prompt)) : undefined;
    const uploaded = iterations.find(iteration => iteration.uploadedFileName && iteration.status !== "REJECTED");
    const latest = uploaded ?? current ?? iterations.find((iteration) => iteration.mediaUri);
    return { asset, source, prompt, sourceCurrent, current, latest };
  });
  const currentPrompts = assetReviews.filter((review) => review.sourceCurrent).length;
  const currentImages = assetReviews.filter((review) => review.current).length;
  const previousImages = assetReviews.filter((review) => review.latest && !review.current).length;
  const startRun = (kind: AssetGenerationRun["kind"], phase: AssetGenerationPhase, message: string) => {
    const id = assetGenerationRuns.start(picture.id, kind, phase, message);
    if (!id) return null;
    const originalImages = new Set(assets.flatMap((asset) => asset.iterations.map((iteration) => iteration.id)));
    const originalReferences = new Set(assets.flatMap((asset) => asset.references.map((reference) => reference.id)));
    let latestMessage = message;
    const update = (message: string, phase?: AssetGenerationPhase) => {
      latestMessage = message;
      assetGenerationRuns.update(picture.id, id, { message, ...(phase ? { phase } : {}) });
    };
    const publish = (next: Picture) => {
      replaceActive(next);
      const currentAssets = next.production?.assets.filter(isVisualAsset) ?? [];
      const prompts = currentAssets.filter((asset) => {
        try { return next.assetPromptSources?.[asset.id]?.contextHash === assetPromptContext(next, asset).hash; }
        catch { return false; }
      }).length;
      assetGenerationRuns.update(picture.id, id, { counts: { assets: currentAssets.length, prompts,
        images: currentAssets.flatMap((asset) => asset.iterations).filter((iteration) => iteration.mediaUri && !originalImages.has(iteration.id)).length,
        references: currentAssets.flatMap((asset) => asset.references).filter((reference) => !originalReferences.has(reference.id)).length,
      } });
    };
    const modelProgress = (event: MoviePlanProgress) => {
      const phase = event.phase === "assetReferences" || event.phase === "assetReferenceChoice" ? "references" : "prompts";
      assetGenerationRuns.update(picture.id, id, { phase,
        output: { model: event.model, text: event.text.slice(-40_000), reasoning: event.reasoning, updatedAt: Date.now() },
        message: event.message || `${event.phase.replace(/([A-Z])/g, " $1")} · ${event.status}${event.reasoning && !event.text ? " · local model is reporting reasoning before its answer" : ""}`,
      }, true);
    };
    const finish = (message = latestMessage) => assetGenerationRuns.finish(picture.id, id, "completed", message);
    const fail = (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assetGenerationRuns.finish(picture.id, id, "failed", message);
      toast.error(message);
    };
    publish(picture);
    return { update, publish, modelProgress, finish, fail };
  };
  const writePrompts = async () => {
    const run = startRun("prompts", "prompts", `The selected local model is replacing all ${assets.length} asset prompts. Previous prompts are kept in history…`);
    if (!run) return;
    try {
      const next = await writeAssetPromptsOnServer(picture, run.modelProgress, true, run.publish, run.update, undefined, true);
      run.publish(next);
      run.finish("Prompts saved. Use Generate images from saved prompts to render them without writing them again.");
    } catch (error) { run.fail(error); }
  };
  const startAssetsOver = async () => {
    if (!picture.screenplay.workingFountain.trim()) return;
    const run = startRun("regenerate", "prompts", "Restarting after the completed screenplay: fresh breakdown, visual development, cinematography, prompts and images…");
    if (!run) return;
    try {
      const fresh: Picture = {
        ...picture, assetImagePrompts: {}, assetPromptSources: {}, assetPromptHistory: [],
        productFlow: { ...hydrateProductFlow(picture.productFlow), reviewInternalPhases: false, qaEnabled: false, thinkingEnabled: false },
        production: null, visualDevelopment: null, cinematography: null, performance: null,
        promptLab: null, generateGates: null, video: null, audio: null, nativeFilm: undefined,
        scenes: [], characters: [], locations: [], props: [], wardrobe: [], vfx: [], shots: [], cues: [], voices: [], thumbnailUrl: null,
        updatedAt: Date.now(),
      };
      run.publish(fresh);
      const rebuilt = await executeMoviePlanOnServer(fresh, run.modelProgress, true, run.publish);
      run.publish(rebuilt.picture);
      const failure = rebuilt.flow.steps.find((step) => step.status === "failed");
      if (failure) throw new Error(failure.message);
      if (rebuilt.flow.nextTouchpoint !== "asset-approval") throw new Error("Production paused for the selected department review. Continue after reviewing it.");
      run.update("Finding references for the freshly rebuilt asset breakdown…", "references");
      const referenced = await findAssetReferencesOnServer(rebuilt.picture, run.update, run.publish, run.modelProgress);
      const next = await writeAssetPromptsOnServer(referenced, run.modelProgress, true, run.publish, run.update, undefined, true);
      run.publish(next);
      run.update(`All fresh prompts saved. Generating images with ${imageModelName}…`, "images");
      await generateAssetDrafts(next, run.publish, run.update, undefined, true);
      run.finish();
    } catch (error) { run.fail(error); }
  };
  const generate = async (assetId?: string) => {
    const run = startRun("images", "images", "Preparing asset image generation…");
    if (!run) return;
    try {
      await generateAssetDrafts(picture, run.publish, run.update, assetId, !assetId);
      run.finish();
    } catch (error) { run.fail(error); }
  };
  const resumeRemaining = async () => {
    const run = startRun("regenerate", "prompts", "Resuming unfinished assets; keeping current prompts and images…");
    if (!run) return;
    try {
      // Make room for the selected writer without changing any saved asset.
      if (currentPrompts < assets.length) await window.premiere316?.stills.unload();
      const next = currentPrompts < assets.length
        ? await writeAssetPromptsOnServer(picture, run.modelProgress, true, run.publish, run.update)
        : picture;
      run.publish(next);
      run.update("Prompts are ready. Generating remaining images from saved prompts…", "images");
      await generateAssetDrafts(next, run.publish, run.update, undefined, true);
      run.finish();
    } catch (error) { run.fail(error); }
  };
  const regenerateCharacterSheet = async (assetId: string) => {
    const asset = assets.find((item) => item.id === assetId);
    if (!asset) return;
    const description = asset.category === "character" ? "character turnaround sheet" : "reference image";
    const run = startRun("regenerate", "prompts", `The local model is rewriting ${asset.name}'s ${description} prompt, then generating its image…`);
    if (!run) return;
    try {
      const next = await writeAssetPromptsOnServer(picture, run.modelProgress, true, run.publish, run.update, assetId);
      run.publish(next);
      run.update(`Generating ${asset.name}'s ${description} with ${imageModelName}…`, "images");
      await generateAssetDrafts(next, run.publish, run.update, assetId);
      run.finish();
    } catch (error) { run.fail(error); }
  };
  return <section aria-label="Generated asset review" className="grid gap-4">
    <AssetRunSummary pictureId={picture.id} />
    <ImportedPackageResources importedPackage={picture.importedPackage} />
    <details className="rounded-md bg-elevated p-3 text-sm"><summary>Global generation instructions · all pictures</summary>
      <label className="mt-3 grid gap-2">Instructions for every picture and local model
        <textarea aria-label="Global generation instructions" className="min-h-64 w-full rounded-md bg-inset p-3 text-fg" disabled={busy} value={globalInstructions} onChange={(event) => setGlobalProductionInstructions(event.target.value)} />
        <span className="text-xs text-muted">Saved app-wide. Applies to every picture's screenplay, Story Doctor, asset breakdown and image prompts. Each asset prompt must use that picture's approved screenplay and cinematography. Changes make earlier prompts outdated.</span>
      </label>
    </details>
    <div className="rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]">
      <h3 className="font-display text-xl">Review generated assets</h3>
      <label className="mt-3 grid max-w-sm gap-2 text-sm">Image model
        <select aria-label="Asset image model" className="rounded-md border border-edge bg-inset p-2 text-fg" disabled={busy} value={picture.selectedEngine.image} onChange={(event) => replaceActive({ ...picture, selectedEngine: { ...picture.selectedEngine, image: event.target.value }, updatedAt: Date.now() })}>
          <option value="krea-2">KREA2 RAW</option><option value="flux2">FLUX.2 Dev</option><option value="flux">FLUX.1 Dev</option>
        </select>
      </label>
      <div className="mt-3"><LocalWriterSelect picture={picture} disabled={busy} label="Asset prompt writer" /></div>
      <p className="mt-2 text-sm">Next generation: {imageModelName}. Each image below shows the model that actually generated it.</p>
      {picture.selectedEngine.image === "krea-2" ? <p className="mt-2 text-sm text-muted">Attached references guide the prompt writer. KREA2 RAW generates from text and does not directly condition on those images.</p> : null}
      <div className="mt-3 flex flex-wrap gap-3">
        <Button disabled={busy || !assets.length || currentImages === assets.length} onClick={() => void resumeRemaining()}>Generate remaining assets</Button>
        <Button disabled={busy || !picture.screenplay.workingFountain.trim()} onClick={() => void startAssetsOver()}>Restart after completed screenplay</Button>
        <Button variant="secondary" disabled={busy || !assets.length} onClick={() => void writePrompts()}>{busy && kind === "prompts" ? "Regenerating prompts…" : "Regenerate prompts"}</Button>
        <Button disabled={busy || !assets.length || currentPrompts < assets.length || currentImages === assets.length} onClick={() => void generate()}>{busy && kind === "images" ? <><Loader2 aria-hidden className="mr-2 size-4 animate-spin motion-reduce:animate-none" />Generating images…</> : currentImages === assets.length ? "Images current" : "Generate images from saved prompts"}</Button>
      </div>
      <p className="mt-2 text-sm text-muted">Generate remaining assets keeps current prompts and images, writes missing or outdated prompts, then renders the remaining images.</p>
      <p className="mt-2 text-sm text-muted">Regenerate prompts replaces all existing prompts using the selected local model, screenplay, cinematography and attached references. Previous versions stay in history. Generate images uses the saved prompts without rewriting them.</p>
      <p className="mt-2 text-sm">{currentPrompts}/{assets.length} current prompts saved · {currentImages}/{assets.length} images match the current {engineById(picture.selectedEngine.image)?.name ?? picture.selectedEngine.image} prompts and references.</p>
      {previousImages ? <p className="mt-2 text-sm text-muted">{previousImages} assets below still show previous images. Their current images have not been generated.</p> : null}
      {runStatus === "interrupted" ? <details className="mt-3 text-sm"><summary className="cursor-pointer">Previous interrupted run</summary><AssetRunActivity pictureId={picture.id} /></details> : <AssetRunActivity pictureId={picture.id} />}
    </div>
    <nav aria-label="Asset categories" className="flex flex-wrap gap-2">
      <Button variant={category === "all" ? "primary" : "secondary"} aria-pressed={category === "all"} onClick={() => setCategory("all")}>All assets ({allAssets.length})</Button>
      {ASSET_REVIEW_GROUPS.map((group) => <Button key={group.id} variant={category === group.id ? "primary" : "secondary"} aria-pressed={category === group.id} onClick={() => setCategory(group.id)}>{group.label} ({allAssets.filter((asset) => assetReviewGroup(asset.category).id === group.id).length})</Button>)}
    </nav>
    {ASSET_REVIEW_GROUPS.filter((group) => category === group.id || category === "all" && allAssets.some((asset) => assetReviewGroup(asset.category).id === group.id)).map((group) => <section key={group.id} aria-label={`${group.label} assets`} className="grid gap-4">
      <h3 className="font-display text-2xl">{group.label}</h3>
      {group.id === "characters" ? <p className="text-sm text-muted">Character turnaround sheets: five full-body angles across the upper row, five large facial close-ups in a separate lower row, on plain grey. Open a sheet to inspect it at full size.</p> : null}
      {group.id === "characters" ? <details className="rounded-md bg-elevated p-3 text-sm"><summary className="cursor-pointer font-medium">Instructions for the prompt writer</summary><div className="mt-3 grid gap-3"><p>{CHARACTER_IDENTITY_SHEET_CONTRACT.layout}</p><p>{CHARACTER_IDENTITY_SHEET_CONTRACT.background}</p><p>{CHARACTER_IDENTITY_SHEET_CONTRACT.continuity}</p><p>{CHARACTER_IDENTITY_SHEET_CONTRACT.referenceRoles}</p></div></details> : null}
      {!allAssets.some((asset) => assetReviewGroup(asset.category).id === group.id) ? <p className="text-sm text-muted">No {group.label.toLowerCase()} assets in the current screenplay breakdown.</p> : null}
      <div className="grid gap-4 md:grid-cols-2">
      {assetReviews.filter(({ asset }) => assetReviewGroup(asset.category).id === group.id).map(({ asset, source, prompt, sourceCurrent, current, latest }) => {
        return <article key={asset.id} className="grid gap-3 rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]">
          <h4 className="font-display text-xl">{asset.name}</h4>
          <AssetReferenceUpload record={picture.production!} assetId={asset.id} disabled={busy} onChange={production => replaceActive({ ...useStudio.getState().pictures.find(p => p.id === picture.id)!, production, updatedAt: Date.now() })} />
          {asset.references.length ? <div className="flex flex-wrap gap-2">{asset.references.map(ref => <button type="button" key={ref.id} aria-label={`Open reference ${ref.name}`} onClick={() => setPreview({ name: ref.name, uri: ref.uri })}><img src={ref.uri} alt={ref.name} className="size-20 rounded-md object-contain" /></button>)}</div> : null}
          <p className="text-xs uppercase tracking-wide text-muted">{asset.category.replaceAll("_", " ")}</p>
          {latest && !current ? <p className="text-sm text-accent">{asset.category === "character" ? "Previous image · New character sheet not generated yet" : "Previous image · Current generation pending"}</p> : null}
          {latest?.mediaUri ? <button className="grid gap-2 text-left" aria-label={`Enlarge ${asset.name} image`} onClick={() => setPreview({ name: asset.name, uri: latest.mediaUri! })}><img src={latest.mediaUri} alt={asset.name} className="aspect-square w-full rounded-md object-contain" /><span className="text-sm text-accent">Open image · {latest.width} × {latest.height}</span></button> : <p className="py-8 text-sm text-muted">Image generation pending.</p>}
          {latest?.uploadedFileName ? <p className="text-sm text-accent">Uploaded asset · {latest.uploadedFileName}</p> : null}
          {latest?.execution ? <p className="text-sm text-muted">Generated with {latest.execution.engineName}{latest.execution.engineId !== picture.selectedEngine.image ? " · Different from selected model" : ""}</p> : null}
          {asset.references.length ? <details className="text-sm"><summary className="cursor-pointer">Attached visual references ({asset.references.length})</summary><div className="mt-2 grid grid-cols-2 gap-2">{asset.references.map((reference) => <figure key={reference.id}><img src={reference.uri} alt={reference.name} className="aspect-square w-full object-contain" /><figcaption className="mt-1 text-xs text-muted">{reference.name}</figcaption></figure>)}</div></details> : null}
          <details className="text-sm text-muted"><summary>Screenplay asset description</summary><p className="mt-2">{asset.canonicalSpec.visualDescription}</p></details>
          <p className="text-sm text-muted">{sourceCurrent ? `Prompt linked to current screenplay and cinematography · ${source?.tokenCount} tokens when written` : prompt ? "Saved prompt needs updating for the current screenplay" : "Generation prompt has not been written yet"}</p>
          {source ? <details className="text-sm text-muted"><summary className="cursor-pointer">Screenplay references</summary><p className="mt-2">{source.sceneIds.join(", ")}</p><blockquote className="mt-2">{source.sourceQuote}</blockquote><p className="mt-2">Written by {source.modelId}</p></details> : null}
          <label className="grid gap-2 text-sm">Generation prompt<textarea aria-label={`${asset.name} image prompt`} placeholder="The model's full generation prompt will appear here after it is written and validated." className="min-h-28 w-full rounded-md bg-inset p-3 text-fg" disabled={busy} value={prompt} onChange={(event) => replaceActive({ ...picture, assetImagePrompts: { ...picture.assetImagePrompts, [asset.id]: event.target.value }, updatedAt: Date.now() })} /></label>
          <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => void regenerateCharacterSheet(asset.id)}>{asset.category === "character" ? "Regenerate character sheet" : "Regenerate prompt and image"}</Button><Button variant="secondary" disabled={busy || !sourceCurrent} onClick={() => void generate(asset.id)}>{latest ? "Regenerate image from saved prompt" : "Generate image"}</Button><Button variant="secondary" disabled={busy || !latest} onClick={() => useStudio.getState().setStage("review")}>Review and approve image</Button></div>
          {asset.approvedIterationId ? <p className="text-sm text-accent">Approved image selected</p> : null}
        </article>;
      })}
      {allAssets.filter((asset) => !isVisualAsset(asset) && assetReviewGroup(asset.category).id === group.id).map((asset) => <article key={asset.id} className="grid gap-3 rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)]"><h4 className="font-display text-xl">{asset.name}</h4><p className="text-sm">{asset.canonicalSpec.visualDescription}</p><p className="text-sm text-muted">{asset.requiredSceneIds.length} linked scenes · {asset.category === "voice" ? "Voice asset" : asset.category === "music" ? "Music asset" : asset.category === "sound" ? "Sound asset" : "Production record"}</p><Button variant="secondary" onClick={() => useStudio.getState().setStage("inventory")}>Review asset specification</Button></article>)}
      </div>
    </section>)}
    <Dialog.Root open={Boolean(preview)} onOpenChange={(open) => { if (!open) setPreview(null); }}>
      <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-bg/90" /><Dialog.Content className="fixed inset-4 z-50 flex flex-col gap-3 overflow-auto rounded-lg bg-elevated p-4 text-fg">
        <div className="flex items-center justify-between gap-4"><Dialog.Title className="font-display text-xl">{preview?.name}</Dialog.Title><Dialog.Close asChild><Button variant="secondary">Close image</Button></Dialog.Close></div>
        <Dialog.Description className="text-sm text-muted">Inspect facial detail, costume, and consistency across the views.</Dialog.Description>
        {preview ? <img src={preview.uri} alt={`${preview.name} enlarged`} className="min-h-0 flex-1 self-center object-contain" /> : null}
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  </section>;
}
