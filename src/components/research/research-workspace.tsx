import "./research-workbench.css";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, ChevronLeft, ChevronRight, FolderPlus, GitBranch, RefreshCw, Save, Search } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { AssetImagePreview } from "@/components/studio/asset-image-preview";
import { useActivePicture, useStudio } from "@/lib/studio/store";
import type { ProductionAsset } from "@/lib/production/types";
import { SourceLedgerPanel, AddSourceForm } from "./source-ledger-panel";
import { SocialWorldPanel } from "./social-world-panel";
import {
  cloneResearchContent,
  RESEARCH_BIBLE_SECTION_KEYS,
  RESEARCH_BIBLE_SECTION_LABELS,
  researchSourceFromFile,
  saveResearchDraft,
  type PictureResearchBible,
  type ResearchContent,
  type ResearchSource,
} from "@/lib/research/bible.ts";
import { addResearchSource, classifyResearchSource, disputesForSources, recordResearchDispute, resolveResearchDispute } from "@/lib/research/source-ledger.ts";
import { approveResearchOrError } from "@/lib/research/research-approval.ts";
import { startDeltaResearch } from "@/lib/research/delta-research.ts";
import {
  RESEARCH_EMPTY_SECTIONS,
  RESEARCH_MANUAL_SUMMARY,
  RESEARCH_ROOM_PRIMARY_CTA,
  RESEARCH_ROOM_REGENERATE_CTA,
  RESEARCH_SOURCE_MATERIAL_CTA,
  researchBibleGenerated,
  researchRoomView,
} from "@/lib/research/research-room.ts";
import { uid } from "@/lib/utils";
import type { Character, Asset } from "@/lib/studio/types";
import { PRODIGAL_SON_PICTURE_ID } from "@/lib/studio/prodigal-son";
import { loadBundledMediaMap, resolveSiteImageUri, type BundledMediaMap } from "@/lib/studio/site-media-preview.ts";

// The approved Research composition has a dedicated picture wallpaper. Location
// thumbnails always switch to their actual asset image when selected.
const RESEARCH_WALLPAPER_URI = "/pictures/prodigal-son/wallpapers/research-galilee.webp";
const FEATURED_LOCATION_IDS = [
  "PS-LOC-TOWN",
  "PS-LOC-MARKET",
  "PS-LOC-HILLSIDE",
  "PS-LOC-HOMESTEAD",
  "PS-LOC-COURTYARD",
  "PS-LOC-OUTSKIRTS",
] as const;
const RESEARCH_TOPIC_LABELS: Record<string, string> = {
  "PS-LOC-TOWN": "Galilean Villages",
  "PS-LOC-MARKET": "Jewish Marketplace",
  "PS-LOC-HILLSIDE": "Olive Hillsides",
  "PS-LOC-HOMESTEAD": "Agriculture",
  "PS-LOC-COURTYARD": "Domestic Life",
  "PS-LOC-OUTSKIRTS": "Rural Routes",
};

const SECTIONS = [
  ["overview", "Overview"],
  ["sources", "Sources"],
  ["social", "Social world"],
  ["camera", "Cinematography"],
  ["risks", "Risks"],
  ["versions", "Versions"],
] as const;
type Section = (typeof SECTIONS)[number][0];

/** Only the exact approved correction may be shown as approved. */
function locationImage(asset: ProductionAsset, pictureId: string | undefined, mediaMap: BundledMediaMap) {
  const resolve = (previewUri?: string, mediaUri?: string) =>
    resolveSiteImageUri(pictureId ?? "", previewUri, mediaMap) ?? resolveSiteImageUri(pictureId ?? "", mediaUri, mediaMap);
  const approved = asset.iterations.find((item) => item.id === asset.approvedIterationId);
  const approvedUri = resolve(approved?.previewUri, approved?.mediaUri);
  if (approvedUri) return { previewUri: approvedUri, mediaUri: approvedUri, draftFallback: false };
  const draft = [...asset.iterations].reverse().find((item) => item.status !== "REJECTED" && resolve(item.previewUri, item.mediaUri));
  const draftUri = resolve(draft?.previewUri, draft?.mediaUri);
  if (draftUri) return { previewUri: draftUri, mediaUri: draftUri, draftFallback: Boolean(approved) };
  const reference = asset.references.find((item) => item.preferred) ?? asset.references[0];
  const referenceUri = resolve(reference?.previewUri, reference?.uri);
  return referenceUri ? { previewUri: referenceUri, mediaUri: referenceUri, draftFallback: Boolean(approved) } : null;
}

export function ResearchWorkspace({
  title,
  bible,
  llamaAvailable,
  characters = [],
  locations = [],
  onChange,
  onRescan,
  onBuildDraft,
  building = false,
}: {
  title: string;
  bible: PictureResearchBible;
  llamaAvailable: boolean | null;
  characters?: Character[];
  locations?: Asset[];
  onChange: (bible: PictureResearchBible) => void;
  onRescan: () => void;
  onBuildDraft: () => Promise<void>;
  building?: boolean;
}) {
  const [section, setSection] = useState<Section>(() =>
    researchBibleGenerated(bible) ? "sources" : "overview",
  );
  const [draft, setDraft] = useState<ResearchContent>(cloneResearchContent(bible.content));
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [manualRequested, setManualRequested] = useState(false);
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [mediaMap, setMediaMap] = useState<BundledMediaMap>({});
  const manualRef = useRef<HTMLDetailsElement>(null);
  const packRef = useRef<HTMLInputElement>(null);
  const referenceTrackRef = useRef<HTMLDivElement>(null);
  const picture = useActivePicture();
  useEffect(() => {
    if (picture?.id !== PRODIGAL_SON_PICTURE_ID) { setMediaMap({}); return; }
    let current = true;
    void loadBundledMediaMap().then((mapping) => { if (current) setMediaMap(mapping); });
    return () => { current = false; };
  }, [picture?.id]);
  const loadedVersion = useRef(`${picture?.id ?? ""}:${bible.currentVersionId ?? ""}`);
  const returnToDefaultMode = useStudio((state) => state.returnToDefaultMode);
  const view = researchRoomView(bible, llamaAvailable);
  const visualLocations = [
    ...(picture?.production?.assets.filter(
      (asset) => asset.category === "location" && !asset.tombstone,
    ) ?? []),
  ].sort((a, b) => {
    const first = FEATURED_LOCATION_IDS.indexOf(a.id as (typeof FEATURED_LOCATION_IDS)[number]);
    const second = FEATURED_LOCATION_IDS.indexOf(b.id as (typeof FEATURED_LOCATION_IDS)[number]);
    return (first < 0 ? Infinity : first) - (second < 0 ? Infinity : second);
  });
  const selectedLocation =
    visualLocations.find((item) => item.id === selectedLocationId) ??
    visualLocations.find((item) => locationImage(item, picture?.id, mediaMap)) ??
    visualLocations[0];
  const image = selectedLocation && locationImage(selectedLocation, picture?.id, mediaMap);
  const showingPictureWallpaper =
    picture?.id === PRODIGAL_SON_PICTURE_ID && !selectedLocationId;
  const showingGalilee = picture?.id === PRODIGAL_SON_PICTURE_ID;
  const backdrop =
    (showingPictureWallpaper
      ? { previewUri: RESEARCH_WALLPAPER_URI, mediaUri: RESEARCH_WALLPAPER_URI }
      : image) ??
    (picture?.thumbnailUrl
      ? { previewUri: picture.thumbnailUrl, mediaUri: picture.thumbnailUrl }
      : null);

  useEffect(() => {
    const key = `${picture?.id ?? ""}:${bible.currentVersionId ?? ""}`;
    if (loadedVersion.current === key) return;
    loadedVersion.current = key;
    // A newly generated or selected version replaces the working view. Ordinary field edits
    // keep the same version ID, so they cannot erase the user's unsaved draft.
    setDraft(cloneResearchContent(bible.content));
  }, [bible.currentVersionId, bible.content, picture?.id]);

  useEffect(() => {
    if (section !== "sources" || !manualRequested) return;
    if (manualRef.current) {
      manualRef.current.open = true;
      manualRef.current.scrollIntoView({ block: "nearest" });
    }
    setManualRequested(false);
  }, [section, manualRequested]);

  const persistContent = (content: ResearchContent) => {
    setDraft(content);
    onChange({ ...bible, content, updatedAt: Date.now() });
  };

  const addSource = (partial: Omit<ResearchSource, "id" | "createdAt">) => {
    const now = Date.now();
    const added = addResearchSource(draft.sources, { ...partial, id: uid("src"), createdAt: now });
    if ("error" in added) {
      toast.error(added.error);
      return;
    }
    persistContent({
      ...draft,
      sources: added.sources,
      disputes: disputesForSources(added.sources, draft.disputes, now),
    });
  };

  const openManualNotes = () => {
    setSection("sources");
    setManualRequested(true);
  };
  const addSourceMaterial = () => packRef.current?.click();
  const buildResearchDraft = () => {
    if (llamaAvailable === false) {
      toast.error(`${view.offlineTitle} ${view.offlineBody}`);
      return;
    }
    void onBuildDraft();
  };

  return (
    <div
      className="research-workbench"
      data-research-room="true"
      data-research-status={view.status}
      data-research-empty={view.showEmptyState ? "true" : "false"}
      data-research-offline={view.showOffline ? "true" : "false"}
      data-research-mode-panel="false"
    >
      <div className="research-cinema-backdrop" aria-hidden="true">
        {backdrop && (
          <AssetImagePreview
            key={`${showingPictureWallpaper ? "research-wallpaper" : selectedLocation?.id ?? picture?.id}:${backdrop.previewUri ?? backdrop.mediaUri}`}
            previewUri={backdrop.previewUri}
            mediaUri={backdrop.mediaUri}
            alt=""
            className="research-cinema-image"
            compact
          />
        )}
      </div>
      <input
        ref={packRef}
        type="file"
        accept=".txt,.md,.fountain,text/plain,text/markdown"
        multiple
        className="sr-only"
        onChange={(event) => {
          const files = event.currentTarget.files;
          if (!files?.length) return;
          void Promise.all(
            [...files].map(async (file) => ({ name: file.name, text: await file.text() })),
          ).then((entries) => {
            let sources = draft.sources;
            let disputes = draft.disputes;
            for (const entry of entries) {
              const now = Date.now();
              const result = addResearchSource(
                sources,
                researchSourceFromFile(entry.name, entry.text, uid("src"), now),
              );
              if ("error" in result) {
                toast.error(result.error);
                continue;
              }
              sources = result.sources;
              disputes = disputesForSources(sources, disputes, now);
            }
            persistContent({ ...draft, sources, disputes });
            toast.success("Source material added.");
          });
          event.currentTarget.value = "";
        }}
      />
      <div className="research-room-stage">
        <section className="research-room-hero" aria-label="Research picture">
          <p className="research-room-kicker">RESEARCH</p>
          <h1>{showingGalilee ? "First-Century Galilee" : title || "Picture Research"}</h1>
          <p className="research-room-subtitle">{showingGalilee ? "Real Places. Deeper Stories." : view.purpose}</p>
          <p className="research-room-measures">
            {draft.sources.length} sources · {draft.socialWorldNotes.length} social notes ·{" "}
            {bible.versions.length} versions
          </p>
          {selectedLocation && !showingPictureWallpaper && (
            <p className="research-current-place">Location reference: {selectedLocation.name}{image?.draftFallback ? " · imported draft; approved correction unavailable" : ""}</p>
          )}
          <div className="research-hero-actions">
            <Button onClick={buildResearchDraft} disabled={building}>
              <Search /> {building ? "Building…" : RESEARCH_ROOM_PRIMARY_CTA}
            </Button>
            <Button variant="secondary" onClick={buildResearchDraft} disabled={building}>
              <RefreshCw /> {RESEARCH_ROOM_REGENERATE_CTA}
            </Button>
            <Button
              variant="ghost"
              disabled={!bible.approvedVersionId}
              onClick={() => {
                onChange(startDeltaResearch(bible, draft, uid("rsv")));
                toast.message("Delta Research opened. Approved notes remain.");
              }}
            >
              <GitBranch /> Delta Research
            </Button>
          </div>
          {view.showOffline && (
            <div className="research-offline-note" data-research-offline-panel="true">
              <strong>{view.offlineTitle}</strong>
              <p>{view.offlineBody}</p>
              <div>
                <Button size="sm" variant="ghost" onClick={onRescan}>
                  <RefreshCw />
                  Rescan
                </Button>
                <Button size="sm" variant="ghost" onClick={addSourceMaterial}>
                  {RESEARCH_SOURCE_MATERIAL_CTA}
                </Button>
                <Button size="sm" variant="ghost" onClick={openManualNotes}>
                  {RESEARCH_MANUAL_SUMMARY}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => returnToDefaultMode()}>
                  Return to Default Mode
                </Button>
              </div>
            </div>
          )}
        </section>

        <aside className="research-room-inspector" aria-label="Research Bible">
          <div className="research-inspector-heading">
            <span>Research Bible</span>
            <Badge>{view.statusLabel}</Badge>
          </div>
          <nav className="research-section-tabs" aria-label="Research sections">
            {SECTIONS.map(([id, label]) => (
              <button
                key={id}
                aria-current={section === id ? "page" : undefined}
                onClick={() => setSection(id)}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="research-inspector-scroll">
            {section === "overview" && (
              <div className="research-section-content">
                <h2>Research Bible</h2>
                {view.showEmptyState && (
                  <div data-research-empty-state="true">
                    <p>No Research Bible has been generated yet.</p>
                    <p>Build Research Draft to draft:</p>
                    <ul>
                      {RESEARCH_EMPTY_SECTIONS.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <dl className="research-overview-cast">
                  <dt>Characters</dt>
                  <dd>
                    {characters.length
                      ? characters.map((item) => item.name).join(", ")
                      : "Not in Research Bible yet"}
                  </dd>
                  <dt>Locations</dt>
                  <dd>
                    {locations.length
                      ? locations.map((item) => item.name).join(", ")
                      : "Not in Research Bible yet"}
                  </dd>
                </dl>
                <p className="research-section-hint">
                  All {RESEARCH_BIBLE_SECTION_KEYS.length} sections, including source evidence and production feasibility, stay
                  editable here.
                </p>
                {RESEARCH_BIBLE_SECTION_KEYS.map((key) => (
                  <details className="research-section-entry" key={key}>
                    <summary>
                      {RESEARCH_BIBLE_SECTION_LABELS[key]}
                      <ArrowUpRight size={14} />
                    </summary>
                    <Textarea
                      aria-label={RESEARCH_BIBLE_SECTION_LABELS[key]}
                      rows={7}
                      value={draft.sections[key]}
                      placeholder="No direction recorded yet"
                      onChange={(event) =>
                        persistContent({
                          ...draft,
                          sections: { ...draft.sections, [key]: event.target.value },
                        })
                      }
                    />
                  </details>
                ))}
              </div>
            )}

            {section === "sources" && (
              <div className="research-section-content">
                <h2>Sources & disputes</h2>
                <SourceLedgerPanel
                  content={draft}
                  onRecordDispute={(input) => {
                    const result = recordResearchDispute(draft, input, Date.now());
                    if ("error" in result) toast.error(result.error);
                    else persistContent(result.content);
                  }}
                  onResolveDispute={(id, note) => {
                    const result = resolveResearchDispute(draft, id, note, Date.now());
                    if ("error" in result) toast.error(result.error);
                    else persistContent(result.content);
                  }}
                  onClassifySource={(id, confidence) => {
                    const result = classifyResearchSource(draft, id, confidence);
                    if ("error" in result) toast.error(result.error);
                    else persistContent(result.content);
                  }}
                />
                <div className="research-source-actions">
                  <Button variant="ghost" size="sm" onClick={addSourceMaterial}>
                    <FolderPlus />
                    {RESEARCH_SOURCE_MATERIAL_CTA}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={openManualNotes}>
                    {RESEARCH_MANUAL_SUMMARY}
                  </Button>
                </div>
                <details
                  ref={manualRef}
                  id="manual-source-entry"
                  data-manual-source-entry="true"
                  className="research-manual-entry"
                >
                  <summary>{RESEARCH_MANUAL_SUMMARY}</summary>
                  <AddSourceForm onAdd={addSource} />
                  <Button size="sm" variant="secondary" onClick={() => setPasteOpen(true)}>
                    Paste source text
                  </Button>
                  <label>
                    Research notes
                    <Textarea
                      value={draft.notes}
                      onChange={(event) => persistContent({ ...draft, notes: event.target.value })}
                    />
                  </label>
                </details>
                {pasteOpen && (
                  <form
                    className="research-paste-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      addSource({
                        title: pasteTitle.trim() || "Pasted source",
                        locator: "pasted-source-text",
                        quote: pasteText,
                        confidence: "C",
                        importedFrom: null,
                      });
                      setPasteTitle("");
                      setPasteText("");
                      setPasteOpen(false);
                      toast.success("Source material added.");
                    }}
                  >
                    <h3>Source material</h3>
                    <Input
                      value={pasteTitle}
                      onChange={(event) => setPasteTitle(event.target.value)}
                      placeholder="Title"
                    />
                    <Textarea
                      value={pasteText}
                      onChange={(event) => setPasteText(event.target.value)}
                      placeholder="Source text"
                      required
                    />
                    <div>
                      <Button type="submit" size="sm">
                        Add source material
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setPasteOpen(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            )}

            {section === "social" && (
              <div className="research-section-content">
                <h2>Social world</h2>
                <SocialWorldPanel content={draft} onChange={persistContent} />
              </div>
            )}
            {section === "camera" && (
              <div className="research-section-content research-direction-fields">
                <h2>Cinematography</h2>
                <p>
                  Picture-level cinematography research. This does not rewrite shots or prompts.
                </p>
                {(
                  [
                    ["thesis", "Thesis"],
                    ["lensLanguage", "Lens language"],
                    ["lighting", "Lighting"],
                    ["geography", "Geography"],
                    ["movement", "Movement"],
                    ["texture", "Texture / grain"],
                    ["soundWorld", "Sound world"],
                    ["musicResearch", "Music research"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key}>
                    <Label>{label}</Label>
                    <Textarea
                      value={draft.cinematographyManifesto[key]}
                      onChange={(event) =>
                        persistContent({
                          ...draft,
                          cinematographyManifesto: {
                            ...draft.cinematographyManifesto,
                            [key]: event.target.value,
                          },
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            )}
            {section === "risks" && (
              <div className="research-section-content research-direction-fields">
                <h2>Risks & feasibility</h2>
                <div>
                  <Label>Risks / disputes</Label>
                  <Textarea
                    value={draft.risks}
                    onChange={(event) => persistContent({ ...draft, risks: event.target.value })}
                  />
                </div>
                <div>
                  <Label>AI production feasibility</Label>
                  <Textarea
                    value={draft.feasibility}
                    onChange={(event) =>
                      persistContent({ ...draft, feasibility: event.target.value })
                    }
                  />
                </div>
              </div>
            )}
            {section === "versions" && (
              <div
                className="research-section-content research-versions"
                data-research-status-panel="true"
              >
                <h2>Versions & status</h2>
                <dl>
                  <dt>Research status</dt>
                  <dd>{view.statusLabel}</dd>
                  <dt>Configured model</dt>
                  <dd>{view.modelStatusLabel}</dd>
                </dl>
                <Button size="sm" variant="secondary" onClick={onRescan}>
                  <RefreshCw />
                  Rescan availability
                </Button>
                <h3>Version history</h3>
                <ol>
                  {[...bible.versions].reverse().map((version) => (
                    <li key={version.id}>
                      <strong>{version.label}</strong>
                      <span>
                        {version.scope} · {new Date(version.createdAt).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ol>
                {!bible.versions.length && <p>No version has been saved yet.</p>}
              </div>
            )}
          </div>
          <footer className="research-room-footer">
            <Button
              variant="secondary"
              onClick={() => {
                const saved = saveResearchDraft(bible, draft, uid("rsv"));
                if ("error" in saved) {
                  toast.error(saved.error);
                  return;
                }
                onChange(saved);
                toast.success("Research draft saved.");
              }}
            >
              <Save />
              Save research
            </Button>
            <Button
              disabled={bible.status === "APPROVED"}
              onClick={() => {
                const approved = approveResearchOrError({ ...bible, content: draft }, uid("rsv"));
                if ("error" in approved) {
                  toast.error(approved.error);
                  return;
                }
                onChange(approved);
                toast.success("Research Bible approved.");
              }}
            >
              <Check />
              Approve research
            </Button>
          </footer>
        </aside>
      </div>

      <div
        className="research-reference-rail"
        aria-label={visualLocations.length ? "Research topics and location references" : "Research sections"}
      >
        <button
          type="button"
          className="research-reference-arrow"
          aria-label="Previous references"
          onClick={() => referenceTrackRef.current?.scrollBy({ left: -450, behavior: "smooth" })}
        >
          <ChevronLeft size={22} aria-hidden="true" />
        </button>
        <div className="research-reference-track" ref={referenceTrackRef}>
          {visualLocations.length
            ? visualLocations.map((asset, index) => {
                const thumbnail = locationImage(asset, picture?.id, mediaMap);
                return (
                  <button
                    key={asset.id}
                    className="research-reference-item"
                    aria-current={(showingPictureWallpaper ? index === 0 : asset.id === selectedLocation?.id) ? "true" : undefined}
                    onClick={() => setSelectedLocationId(showingGalilee && index === 0 ? "" : asset.id)}
                  >
                    <span className="research-reference-thumb">
                      {thumbnail && (
                        <AssetImagePreview
                          key={`${asset.id}:${thumbnail.previewUri ?? thumbnail.mediaUri}`}
                          previewUri={thumbnail.previewUri}
                          mediaUri={thumbnail.mediaUri}
                          alt=""
                          compact
                        />
                      )}
                    </span>
                    <span>{showingGalilee ? RESEARCH_TOPIC_LABELS[asset.id] ?? asset.name : asset.name}{thumbnail?.draftFallback ? <small className="block text-[10px]">Draft preview</small> : null}</span>
                  </button>
                );
              })
            : SECTIONS.map(([id, label]) => (
                <button
                  key={id}
                  className="research-reference-item research-reference-section"
                  aria-current={section === id ? "true" : undefined}
                  onClick={() => setSection(id)}
                >
                  <span className="research-reference-thumb">
                    <span>{label}</span>
                  </span>
                  <span>{label}</span>
                </button>
              ))}
        </div>
        <button
          type="button"
          className="research-reference-arrow"
          aria-label="Next references"
          onClick={() => referenceTrackRef.current?.scrollBy({ left: 450, behavior: "smooth" })}
        >
          <ChevronRight size={22} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
