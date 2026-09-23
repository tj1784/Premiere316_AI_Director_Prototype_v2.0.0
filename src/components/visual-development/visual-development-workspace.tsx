import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useActivePicture } from "@/lib/studio/store";
import { loadBundledMediaMap, loadBundledScenePreviews, resolveSiteStillPreview, type BundledMediaMap, type BundledScenePreview } from "@/lib/studio/site-media-preview";
import { approveVisualRecord, checkVisualDrift, type VisualDevelopmentState } from "@/lib/visual-development";
import "./visual-cinema.css";

type View = "look" | "identity" | "world" | "qa";

export function VisualDevelopmentWorkspace({ state, onChange }: { state: VisualDevelopmentState; onChange: (state: VisualDevelopmentState) => void }) {
  const picture = useActivePicture();
  const [view, setView] = useState<View>("look");
  const [selectedRecord, setSelectedRecord] = useState("");
  const [selectedFrame, setSelectedFrame] = useState("");
  const [previews, setPreviews] = useState<BundledScenePreview[]>([]);
  const [mediaMap, setMediaMap] = useState<BundledMediaMap>({});
  useEffect(() => {
    if (picture?.id !== "pic_prodigal_son_20260909") return;
    let live = true;
    void Promise.all([loadBundledScenePreviews(), loadBundledMediaMap()]).then(([frames, map]) => {
      if (live) { setPreviews(frames); setMediaMap(map); }
    });
    return () => { live = false; };
  }, [picture?.id]);

  const board = state.boards.find((item) => item.id === selectedRecord) ?? state.boards[0];
  const identity = state.characterBibles.find((item) => item.id === selectedRecord) ?? state.characterBibles[0];
  const worldRecords = [
    ...state.locationBibles.map((item) => ({ kind: "location" as const, id: item.id, title: item.name, status: item.status, item })),
    ...state.wardrobeStates.map((item) => ({ kind: "wardrobe" as const, id: item.id, title: item.label, status: item.status, item })),
    ...state.propBibles.map((item) => ({ kind: "prop" as const, id: item.id, title: item.name, status: item.status, item })),
  ];
  const world = worldRecords.find((item) => item.id === selectedRecord) ?? worldRecords[0];
  const drift = checkVisualDrift(state);
  const stillFrames = picture?.shots.flatMap((shot) => {
    const frame = resolveSiteStillPreview(picture.id, shot.stillUrl, previews, mediaMap);
    return frame ? [{ id: shot.id, uri: frame.uri, title: `Shot ${String(shot.index).padStart(2, "0")}` }] : [];
  }) ?? [];
  const defaultImage = picture?.id === "pic_prodigal_son_20260909"
    ? "/pictures/prodigal-son/wallpapers/father-solo-scene-04.png"
    : picture?.thumbnailUrl;
  const frames = [
    ...(defaultImage ? [{ id: "film", uri: defaultImage, title: picture?.title ?? "Film" }] : []),
    ...stillFrames.filter((frame, index, all) => all.findIndex((other) => other.uri === frame.uri) === index).slice(0, 8),
  ];
  const activeFrame = frames.find((item) => item.id === selectedFrame) ?? frames[0];

  const approve = (kind: "board" | "character" | "wardrobe" | "location" | "prop", id: string) => onChange(approveVisualRecord(state, kind, id));
  return (
    <section className="visual-cinema" aria-label="Visual development">
      {activeFrame ? <img className="visual-cinema-background" src={activeFrame.uri} alt="" /> : null}
      <div className="visual-cinema-vignette" aria-hidden="true" />
      <div className="visual-cinema-title"><p>FILM / ART DIRECTION</p><h2>Visual development</h2><span>{picture?.title ?? "Picture"} · {state.approvals.length} approved records</span></div>
      <div className="visual-cinema-inspector">
        <nav className="visual-cinema-tabs" aria-label="Visual development views">
          {([ ["look", "Look"], ["identity", "Identity"], ["world", "World"], ["qa", "Drift"] ] as const).map(([key, label]) =>
            <button type="button" key={key} aria-pressed={view === key} onClick={() => { setView(key); setSelectedRecord(""); }}>{label}</button>)}
        </nav>
        {view === "look" && (board ? <>
          <RecordChooser label="Look board" records={state.boards.map((item) => ({ id: item.id, label: item.title }))} selectedId={board.id} onChange={setSelectedRecord} />
          <Header title={board.title} status={board.status} />
          <Info label="Visual intent" value={board.intent} />
          <Info label="Palette" value={board.palette.join(" · ")} />
          <Info label="Motifs" value={board.motifs.join(" · ")} />
          <Info label="References" value={board.referenceSlots.map((item) => `${item.label} · ${item.provenance}`).join("\n")} />
          <Button size="sm" disabled={board.status === "APPROVED"} onClick={() => approve("board", board.id)}>Approve look board</Button>
        </> : <p className="visual-cinema-empty">No look board is recorded for this film.</p>)}
        {view === "identity" && (identity ? <>
          <RecordChooser label="Character identity" records={state.characterBibles.map((item) => ({ id: item.id, label: item.name }))} selectedId={identity.id} onChange={setSelectedRecord} />
          <Header title={identity.name} status={identity.status} />
          <Info label="Face" value={identity.facialGeometry} />
          <Info label="Skin, hair & build" value={identity.skinHairBuild} />
          <Info label="Posture" value={identity.posture} />
          <Info label="Identity invariants" value={identity.invariants.join(" · ")} />
          <Info label="Expression matrix" value={Object.entries(identity.expressionMatrix).map(([key, value]) => `${key}: ${value}`).join("\n")} />
          <Info label="Prohibited drift" value={identity.prohibitedDrift.join(" · ")} />
          <Info label="Wardrobe states" value={identity.wardrobeStateIds.join(" · ")} />
          <Info label="Scenes" value={identity.sceneIds.join(" · ")} />
          <Button size="sm" disabled={identity.status === "APPROVED"} onClick={() => approve("character", identity.id)}>Approve identity bible</Button>
        </> : <p className="visual-cinema-empty">No character identity bible is recorded.</p>)}
        {view === "world" && (world ? <>
          <RecordChooser label="World element" records={worldRecords.map((item) => ({ id: item.id, label: item.title }))} selectedId={world.id} onChange={setSelectedRecord} />
          <Header title={world.title} status={world.status} />
          <Info label="Kind" value={world.kind} />
          {world.kind === "location" ? <>
            <Info label="Geography" value={world.item.geography} /><Info label="Era" value={world.item.era} /><Info label="Lighting" value={world.item.lightingLogic} />
            <Info label="Materials" value={world.item.materials.join(" · ")} /><Info label="Continuity" value={world.item.continuityVariants.join(" · ")} /><Info label="Motifs" value={world.item.motifLinks.join(" · ")} />
          </> : world.kind === "wardrobe" ? <>
            <Info label="Era" value={world.item.era} /><Info label="Materials" value={world.item.materials.join(" · ")} /><Info label="Wear state" value={world.item.wearState} />
            <Info label="Continuity" value={world.item.continuityVariants.join(" · ")} /><Info label="Motifs" value={world.item.motifLinks.join(" · ")} />
          </> : <>
            <Info label="Materials" value={world.item.materials.join(" · ")} /><Info label="Wear state" value={world.item.wearState} /><Info label="Hero details" value={world.item.heroDetails.join(" · ")} />
            <Info label="Continuity" value={world.item.continuityVariants.join(" · ")} /><Info label="Motifs" value={world.item.motifLinks.join(" · ")} />
          </>}
          <Button size="sm" disabled={world.status === "APPROVED"} onClick={() => approve(world.kind, world.id)}>Approve {world.kind} bible</Button>
        </> : <p className="visual-cinema-empty">No world elements are recorded.</p>)}
        {view === "qa" && <>
          <Header title="Visual continuity" status={`${drift.length} findings`} />
          {drift.length ? drift.map((item) => <div className="visual-cinema-finding" key={item.id}><span>{item.severity} · {item.recordId}</span><p>{item.message}</p></div>) : <p className="visual-cinema-empty">No visual drift blockers.</p>}
          <Info label="Approved records" value={`${state.approvals.length} / ${state.boards.length + state.characterBibles.length + worldRecords.length}`} />
        </>}
      </div>
      {frames.length > 1 && <nav className="visual-cinema-rail" aria-label="Film scene frames">
        {frames.map((frame) => <button type="button" key={frame.id} aria-pressed={activeFrame?.id === frame.id} onClick={() => setSelectedFrame(frame.id)}><img src={frame.uri} alt="" loading="lazy" /><span>{frame.title}</span></button>)}
      </nav>}
    </section>
  );
}

function Header({ title, status }: { title: string; status: string }) {
  return <header className="visual-cinema-record-title"><h3>{title}</h3><span>{status.replaceAll("_", " ")}</span></header>;
}
function Info({ label, value }: { label: string; value: string }) {
  return <div className="visual-cinema-info"><strong>{label}</strong><span>{value || "Not specified in source"}</span></div>;
}
function RecordChooser({ label, records, selectedId, onChange }: { label: string; records: { id: string; label: string }[]; selectedId: string; onChange: (id: string) => void }) {
  return <label className="visual-cinema-picker"><span>{label}</span><select value={selectedId} onChange={(event) => onChange(event.target.value)}>{records.map((record) => <option key={record.id} value={record.id}>{record.label}</option>)}</select></label>;
}
