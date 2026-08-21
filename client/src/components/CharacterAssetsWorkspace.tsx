import React, { useEffect, useMemo, useState } from "react";
import { assetUrl, useStore } from "../store";
import { activeAssetFile, buildCharacterBundles, readableCharacterText, sourceImportState } from "../character-assets";
import "./character-assets-workspace.css";

async function responseJson(response: Response, operation: string) {
  const raw = await response.text();
  let json: any = {};
  if (raw.trim()) {
    try {
      json = JSON.parse(raw);
    } catch {
      if (response.ok) throw new Error(`${operation} returned an unreadable non-JSON response.`);
    }
  }
  if (!response.ok) {
    const supplied = typeof json?.error === "string" ? json.error.trim() : "";
    if (response.status === 404 && !supplied) {
      throw new Error(`${operation} is not available from the current Premiere316 server (404).`);
    }
    throw new Error(supplied || `${operation} failed (${response.status}${response.statusText ? ` ${response.statusText}` : ""}).`);
  }
  return json;
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.ceil(value / 1024)} KB`;
}

function AssetThumb({ project, asset, onInspect }: { project: any; asset: any; onInspect: () => void }) {
  const file = activeAssetFile(asset);
  const name = readableCharacterText(asset.name);
  const variant = readableCharacterText(asset.variant);
  return (
    <article className="character-bundle-asset">
      <button type="button" className="character-bundle-asset-preview" onClick={onInspect} aria-label={`Inspect ${name}, ${variant}`}>
        {file && /\.(png|jpe?g|webp|gif)$/i.test(file)
          ? <img src={assetUrl(project.slug, file)} alt="" loading="lazy" />
          : <span aria-hidden="true">◇</span>}
        <em className={asset.approvalCurrent ? "approved" : "review"}>{asset.approvalCurrent ? "Approved" : file ? "Review" : "Planned"}</em>
      </button>
      <div><b>{variant || name}</b><small>{file ? `v${asset.activeVersion}` : "No generated version"}</small></div>
    </article>
  );
}

export default function CharacterAssetsWorkspace({ onOpenLibrary }: { onOpenLibrary: () => void }) {
  const store = useStore();
  const project = store.project!;
  const [sources, setSources] = useState<any[]>([]);
  const [sourceRoot, setSourceRoot] = useState("");
  const [unsupportedProjects, setUnsupportedProjects] = useState<any[]>([]);
  const [loadingSources, setLoadingSources] = useState(true);
  const [sourceError, setSourceError] = useState("");
  const [query, setQuery] = useState("");
  const [importingId, setImportingId] = useState("");
  const [notice, setNotice] = useState("");

  const loadSources = async () => {
    setLoadingSources(true);
    setSourceError("");
    try {
      const json = await responseJson(await fetch(`/api/projects/${encodeURIComponent(project.slug)}/character-voice-sources`), "Character voice source scan");
      setSources(json.sources || []);
      setSourceRoot(String(json.root || ""));
      setUnsupportedProjects(json.unsupportedProjects || []);
    } catch (error: any) {
      setSourceError(String(error.message || error));
    } finally {
      setLoadingSources(false);
    }
  };

  useEffect(() => { void loadSources(); }, [project.slug]);

  const bundles = useMemo(
    () => buildCharacterBundles(project.assets?.items || [], sources),
    [project.assets?.items, sources]
  );
  const visible = bundles.filter((bundle: any) => !query.trim() || [
    bundle.name,
    bundle.key,
    ...bundle.characterAssets.map((asset: any) => `${asset.name} ${asset.variant} ${asset.id}`),
    ...bundle.wardrobeAssets.map((asset: any) => `${asset.name} ${asset.variant} ${asset.id}`),
    ...bundle.voiceAssets.map((asset: any) => `${asset.name} ${asset.variant} ${asset.id}`)
  ].join(" ").toLowerCase().includes(query.trim().toLowerCase()));
  const linkedSourceIds = new Set(bundles.flatMap((bundle: any) => bundle.recordings.map((source: any) => source.id)));
  const unmatched = sources.filter((source) => !linkedSourceIds.has(source.id));
  const importedSourceCount = sources.filter((source) => sourceImportState(source).alreadyImported).length;

  const inspect = (asset: any) => {
    store.setSelectedAsset(asset.id);
    onOpenLibrary();
  };

  const importRecording = async (bundle: any, source: any) => {
    if (importingId) return;
    setImportingId(source.id);
    setNotice("");
    setSourceError("");
    try {
      const importState = sourceImportState(source);
      const voiceTarget = bundle.voiceAssets.find((asset: any) => asset.id === importState.existingAssetId) || bundle.voiceAssets[0] || null;
      const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/characters/${encodeURIComponent(bundle.primaryAsset.id)}/import-voice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId: source.id, voiceAssetId: voiceTarget?.id || null })
      });
      const json = await responseJson(response, "Voice import");
      if (!json.alreadyImported) await store.reloadProject();
      setSources((current) => current.map((item) => item.id === source.id ? {
        ...item,
        alreadyImported: true,
        existingAssetId: json.asset?.id || importState.existingAssetId,
        existingAssetName: json.asset?.name || importState.existingAssetName || bundle.name,
        existingVersion: json.version?.v || importState.existingVersion
      } : item));
      const sourceName = readableCharacterText(source.fileName);
      if (json.alreadyImported) {
        setNotice(`${sourceName} is already the exact source for ${readableCharacterText(json.asset?.name || importState.existingAssetName || bundle.name)} v${json.version?.v || importState.existingVersion || "current"}; no duplicate version was created.`);
      } else {
        setNotice(`Imported ${sourceName} as ${readableCharacterText(json.asset?.name || bundle.name)} voice v${json.version?.v || "new"}. Review and approve it in the library.`);
      }
    } catch (error: any) {
      setSourceError(String(error.message || error));
    } finally {
      setImportingId("");
    }
  };

  return (
    <main className="character-assets-workspace">
      <header className="workspace-command-bar">
        <div><span className="workspace-eyebrow">IDENTITY · WARDROBE · VOICE</span><h1>Characters</h1><p>One production bible per character, assembled from exact Asset Library versions.</p></div>
        <div className="workspace-command-actions">
          <label className="character-search"><span>Search characters</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Adam, Eve, Jesus…" /></label>
          <button type="button" className="button secondary" onClick={() => void loadSources()} disabled={loadingSources}>{loadingSources ? "Scanning…" : "Rescan Audacity"}</button>
          <button type="button" className="button primary" onClick={onOpenLibrary}>Open Asset Library</button>
        </div>
      </header>

      <section className="character-assets-source-bar" aria-live="polite" aria-busy={loadingSources}>
        <div><span aria-hidden="true">◖</span><p><b>Character voice source</b><small>{sourceRoot || "C:\\Users\\Blokey\\Documents\\Audacity"}</small></p></div>
        <span>{loadingSources ? "Scanning audio takes…" : `${sources.length} audio take${sources.length === 1 ? "" : "s"} · ${importedSourceCount} already imported · ${unmatched.length} unassigned${unsupportedProjects.length ? ` · ${unsupportedProjects.length} Audacity project file${unsupportedProjects.length === 1 ? "" : "s"} need export` : ""}`}</span>
      </section>
      {sourceError ? <div className="character-assets-notice error" role="alert">{sourceError}</div> : null}
      {notice ? <div className="character-assets-notice success" role="status">{notice}</div> : null}

      <section className="character-bundle-grid" aria-label="Character production bibles">
        {visible.map((bundle: any) => {
          const primaryFile = activeAssetFile(bundle.primaryAsset);
          return (
            <article className="character-bundle-card" key={bundle.key}>
              <header>
                <div className="character-bundle-hero">
                  {primaryFile ? <img src={assetUrl(project.slug, primaryFile)} alt="" loading="lazy" /> : <span aria-hidden="true">◇</span>}
                </div>
                <div><small>CHARACTER BIBLE</small><h2>{readableCharacterText(bundle.name)}</h2><p>{bundle.characterAssets.length} sheet{bundle.characterAssets.length === 1 ? "" : "s"} · {bundle.wardrobeAssets.length} wardrobe · {bundle.voiceAssets.length} voice asset{bundle.voiceAssets.length === 1 ? "" : "s"}</p></div>
                <em className={bundle.complete ? "complete" : "incomplete"}>{bundle.complete ? "Complete" : "Needs coverage"}</em>
              </header>

              <section className="character-bundle-section">
                <div className="character-bundle-section-title"><b>Character sheets</b><span>{bundle.characterAssets.length}</span></div>
                <div className="character-bundle-assets">{bundle.characterAssets.map((asset: any) => <AssetThumb key={asset.id} project={project} asset={asset} onInspect={() => inspect(asset)} />)}</div>
              </section>

              <section className="character-bundle-section">
                <div className="character-bundle-section-title"><b>Wardrobe</b><span>{bundle.wardrobeAssets.length}</span></div>
                {bundle.wardrobeAssets.length
                  ? <div className="character-bundle-assets">{bundle.wardrobeAssets.map((asset: any) => <AssetThumb key={asset.id} project={project} asset={asset} onInspect={() => inspect(asset)} />)}</div>
                  : <p className="character-bundle-empty">No wardrobe asset is assigned.</p>}
              </section>

              <section className="character-bundle-section">
                <div className="character-bundle-section-title"><b>Library voices</b><span>{bundle.voiceAssets.length}</span></div>
                {bundle.voiceAssets.length ? bundle.voiceAssets.map((asset: any) => {
                  const file = activeAssetFile(asset);
                  const assetName = readableCharacterText(asset.name);
                  return <div className="character-library-voice" key={asset.id}><button type="button" onClick={() => inspect(asset)}>{assetName}<small>{readableCharacterText(asset.variant)} · {file ? `v${asset.activeVersion}` : "planned"}</small></button>{file ? <audio src={assetUrl(project.slug, file)} controls preload="none" aria-label={`Preview ${assetName} voice v${asset.activeVersion}`} /> : null}</div>;
                }) : <p className="character-bundle-empty">No voice asset exists yet. Importing a matched take will create one.</p>}
              </section>

              <section className="character-bundle-section audacity-takes">
                <div className="character-bundle-section-title"><b>Audacity takes</b><span>{bundle.recordings.length}</span></div>
                {bundle.recordings.length ? bundle.recordings.map((source: any) => {
                  const importState = sourceImportState(source);
                  const sourceName = readableCharacterText(source.fileName);
                  const provenance = [
                    formatBytes(source.bytes),
                    source.modifiedAt ? new Date(source.modifiedAt).toLocaleString() : "",
                    importState.sha256 ? `SHA-256 ${importState.sha256.slice(0, 12)}…` : ""
                  ].filter(Boolean).join(" · ");
                  return (
                    <div className={`character-source-voice ${importState.alreadyImported ? "already-imported" : ""}`} key={source.id}>
                      <div><b>{sourceName}</b><small>{provenance}</small>{importState.alreadyImported ? <em>Exact source already imported{importState.existingAssetName ? ` as ${importState.existingAssetName}` : ""}{importState.existingVersion ? ` v${importState.existingVersion}` : ""}</em> : null}</div>
                      <audio src={source.previewUrl} controls preload="none" aria-label={`Preview Audacity take ${sourceName}`} />
                      <button type="button" className="button secondary" disabled={Boolean(importingId) || importState.alreadyImported} onClick={() => void importRecording(bundle, source)}>{importingId === source.id ? "Importing…" : importState.alreadyImported ? "Already imported" : bundle.voiceAssets.length ? "Import new voice version" : "Create voice asset"}</button>
                    </div>
                  );
                }) : <p className="character-bundle-empty">No exact filename-matched Audacity take. Unassigned recordings are left untouched.</p>}
              </section>
            </article>
          );
        })}
      </section>

      {!visible.length ? <div className="workspace-empty"><p>{query.trim() ? `No character matches “${query}”.` : "No character identity assets exist in this project yet."}</p></div> : null}
      {unmatched.length ? <details className="character-unmatched premium-panel"><summary>{unmatched.length} unassigned Audacity recording{unmatched.length === 1 ? "" : "s"}</summary><p>These names do not uniquely match a project character, so Premiere316 has not linked or imported them.</p><ul>{unmatched.map((source) => { const sourceName = readableCharacterText(source.fileName); return <li key={source.id}><span>{sourceName}</span><audio src={source.previewUrl} controls preload="none" aria-label={`Preview unassigned Audacity recording ${sourceName}`} /></li>; })}</ul></details> : null}
    </main>
  );
}
