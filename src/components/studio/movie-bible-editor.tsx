import { openAssetIterations, openScreenplayScene } from "./workspace-links";
import { CharacterVoiceSamples } from "./character-voice-samples";
import { CabinetModal, CabinetTabs, CabinetCarousel } from "./cabinet";
import { useState } from "react";
import {
  BIBLE_FIELDS,
  editBibleField,
  movieBibleIndex,
  resolveBibleRecord,
  bibleSearchText,
  type BibleKind,
} from "@/lib/studio/movie-bible";
import { useActivePicture, useStudio } from "@/lib/studio/store";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { toast } from "sonner";
import { RenderContextEditor } from "./render-context-editor";
import type { StageId } from "@/lib/studio/types";
import { useWorkspaceDraft } from "./use-workspace-draft";
import { BibleLibrarySearch } from "./bible-library-search";

export function MovieBibleEditor({
  kinds,
  title = "Movie Script Bible",
}: { kinds?: BibleKind[]; title?: string } = {}) {
  const picture = useActivePicture();
  const patch = useStudio((s) => s.patchActive);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useWorkspaceDraft(`bible-category:${title}`, "all");
  const [fieldGroup, setFieldGroup] = useWorkspaceDraft(`bible-field-group:${title}`, "all");
  const [selected, setSelected] = useWorkspaceDraft(`bible-record:${title}`, "");
  const [editing, setEditing] = useWorkspaceDraft<string | null>(`bible-edit-field:${title}`, null);
  const [value, setValue] = useWorkspaceDraft(`bible-edit-value:${title}`, "");
  const [reason, setReason] = useWorkspaceDraft(`bible-edit-source:${title}`, "");
  const [na, setNa] = useWorkspaceDraft(`bible-edit-na:${title}`, false);
  if (!picture) return null;
  const allRows = movieBibleIndex(picture);
  const availableRows = allRows.filter(
    (r) => (!kinds || kinds.includes(r.kind as BibleKind)) && r.status !== "deleted",
  );
  const rows = availableRows.filter((r) => category === "all" || r.kind === category);
  const row =
    allRows.find((r) => r.id === selected && (category === "all" || r.kind === category)) ??
    rows[0] ??
    availableRows[0];
  if (!row)
    return (
      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-2xl">{title}</h2>
        <p className="mt-2 text-muted">
          No source records yet. Prepare the approved screenplay inventory to author linked sheets
          and states here.
        </p>
      </section>
    );
  const kind = row.kind as BibleKind;
  const fields = BIBLE_FIELDS[kind];
  const record = picture.movieBible?.records[row.id];
  const asset = picture.production?.assets.find(
    (a) => a.id === row.id || (row.kind === "participant" && a.id === row.parentId),
  );
  const media =
    asset?.iterations.find((i) => i.id === asset.approvedIterationId) ??
    [...(asset?.iterations ?? [])].reverse().find((i) => i.mediaUri);
  const mediaUri =
    media?.previewUri ?? media?.mediaUri ?? asset?.references.find((r) => r.preferred)?.uri;
  const groups =
    kind === "character"
      ? [
          { id: "identity", label: "Identity & appearance", fields: fields?.slice(0, 4) ?? [] },
          { id: "inner", label: "Motivation & relationships", fields: fields?.slice(4, 11) ?? [] },
          { id: "performance", label: "Performance & voice", fields: fields?.slice(11) ?? [] },
        ]
      : kind === "location"
        ? [
            { id: "geography", label: "Geography & space", fields: fields?.slice(0, 4) ?? [] },
            {
              id: "atmosphere",
              label: "Light, sound & boundaries",
              fields: fields?.slice(4) ?? [],
            },
          ]
        : kind === "participant"
          ? [
              {
                id: "intention",
                label: "Objective & permissions",
                fields: fields?.slice(0, 5) ?? [],
              },
              { id: "state", label: "Incoming & outgoing state", fields: fields?.slice(5) ?? [] },
            ]
          : [{ id: "direction", label: "Creative direction", fields: fields ?? [] }];
  const displayedFields =
    fieldGroup === "all" ? fields : (groups.find((g) => g.id === fieldGroup)?.fields ?? fields);
  const matching = rows.filter(r => bibleSearchText(r, picture).toLowerCase().includes(query.toLowerCase()));
  const choose = (id: string) => { setSelected(id); setEditing(null); setFieldGroup("all"); };
  return <div className="bible-cabinet">
    <header className="cabinet-heading"><div><p className="workspace-eyebrow">PRODUCTION / SOURCE OF TRUTH</p><h2>{title}</h2></div><div className="cabinet-heading-actions">
      <CabinetModal title="Search all pictures" trigger={<Button variant="secondary" size="sm">Search library</Button>}><BibleLibrarySearch /></CabinetModal>
      <CabinetModal title="Picture settings" trigger={<Button variant="secondary" size="sm">Settings</Button>}><label className="grid gap-3">Creative preset<select className="rounded border border-border bg-inset p-3" value={picture.creativePreset ?? "none"} onChange={e => patch({creativePreset:e.target.value as "none" | "harrowing-v3"})}><option value="none">General film Bible</option><option value="harrowing-v3">Harrowing of Hell V3</option></select><span className="text-sm text-muted">Applies to future authoring. Approved work stays protected.</span></label></CabinetModal>
    </div></header>
    <div className="cabinet-filter-bar"><select aria-label="Bible record category" value={category} onChange={e => {setCategory(e.target.value);choose("");}}><option value="all">All records</option>{[...new Set(availableRows.map(r=>r.kind))].map(k=><option key={k} value={k}>{k.replaceAll("-"," ")}</option>)}</select><Input aria-label="Search Bible records" placeholder="Find a character, scene, source…" value={query} onChange={e=>setQuery(e.target.value)}/><span>{matching.length} records</span></div>
    <CabinetCarousel label="Bible records" items={matching.map(r=><button className="cabinet-record" key={r.id} aria-pressed={row.id===r.id} onClick={()=>choose(r.id)}><span className="cabinet-record-kind">{r.kind}</span><strong>{r.name}</strong><span>{r.status}</span></button>)}/>
    <div className="cabinet-detail">
      <header><div><span className="workspace-eyebrow">{kind} / {row.status}</span><h3>{row.name}</h3></div><Button size="sm" variant="secondary" onClick={()=>{patch({workspacePanel:row.kind==="run"?"run":null});if(row.kind!=="run")useStudio.getState().openAdvancedDepartment(row.locator as StageId);if(row.kind==="shot")useStudio.getState().selectShot(row.id);}}>Open workspace</Button></header>
      <CabinetTabs label="Record cabinet" items={[
        {id:"direction",label:"Direction",content:<><div className="cabinet-field-grid">{fields?.map(field=><button key={field} className="cabinet-field" onClick={()=>{setEditing(field);setValue(record?.fields[field]?.value??"");setReason(record?.fields[field]?.source??"User direction");setNa(record?.fields[field]?.disposition==="not-applicable");}}><span>{field}<small>Edit ↗</small></span><p>{record?.fields[field]?.value||"Add direction"}</p></button>)}</div>{!fields&&<p className="cabinet-empty">Use the canonical workspace to edit this source record.</p>}</>},
        {id:"media",label:"Media & scenes",content:<div className="cabinet-media-layout"><div>{mediaUri?<img src={mediaUri} alt={row.name}/>:<p className="cabinet-empty">No selected image yet.</p>}{asset&&<Button variant="secondary" onClick={()=>openAssetIterations(picture.id,asset.id)}>Asset iterations</Button>}</div><div>{kind==="character"&&<CharacterVoiceSamples pictureId={picture.id} characterId={row.id}/>}<h4>Linked scenes</h4>{(asset?.requiredSceneIds??[]).map(id=><Button key={id} variant="ghost" onClick={()=>openScreenplayScene(picture,id)}>{picture.production?.scenes.find(s=>s.id===id)?.slugline??id}</Button>)}{!asset?.requiredSceneIds.length&&<p className="text-sm text-muted">No linked scenes recorded.</p>}</div></div>},
        {id:"source",label:"Source",content:<><p className="text-xs text-muted">{row.id} · revision {record?.revision??row.revision}</p>{row.parentId&&<Button variant="secondary" onClick={()=>{setCategory("all");choose(row.parentId!);}}>Parent source</Button>}{row.relations?.map(relation=><Button key={`${relation.type}:${relation.targetId}`} variant="ghost" onClick={()=>{setCategory("all");choose(relation.targetId);}}>{relation.type}: {relation.targetId}</Button>)}<pre className="cabinet-source">{JSON.stringify(resolveBibleRecord(picture,row.id),null,2)}</pre></>},
        {id:"history",label:"History",content:<div>{(picture.movieBible?.corrections??[]).filter(c=>c.recordId===row.id).slice().reverse().map(c=><article key={c.id} className="cabinet-history"><h4>{c.field} · revision {c.after.revision}</h4><p>{c.before?.value||"Missing"} → {c.after.value}</p><small>{c.after.source}</small></article>)}{!(picture.movieBible?.corrections??[]).some(c=>c.recordId===row.id)&&<p className="cabinet-empty">No corrections recorded.</p>}</div>},
        ...(!kinds?[{id:"render",label:"Render direction",content:<RenderContextEditor/>}]:[])
      ]}/>
    </div>
    <CabinetModal title={editing??"Edit direction"} open={Boolean(editing)} onOpenChange={open=>{if(!open)setEditing(null);}}><div className="grid gap-4"><Textarea aria-label={editing??"Direction"} rows={8} value={value} onChange={e=>setValue(e.target.value)}/><label className="grid gap-2 text-sm">Source or correction reason<Input aria-label="Source or correction reason" value={reason} onChange={e=>setReason(e.target.value)}/></label><label className="flex gap-2 text-sm"><input type="checkbox" checked={na} onChange={e=>setNa(e.target.checked)}/>Not applicable (explain above)</label><div className="flex justify-end gap-2"><Button variant="ghost" onClick={()=>setEditing(null)}>Cancel</Button><Button onClick={()=>{try{if(!editing)return;patch({movieBible:editBibleField(picture,row.id,kind,editing,value,reason,na?"not-applicable":"authored")});setEditing(null);}catch(error){toast.error(String(error));}}}>Save direction</Button></div></div></CabinetModal>
  </div>;
}
