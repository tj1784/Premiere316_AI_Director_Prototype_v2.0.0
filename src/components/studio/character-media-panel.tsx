import { useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Expand,
  ImagePlus,
  Images,
  Mic2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AssetReferenceUpload } from "@/components/production/asset-reference-upload";
import type { ProductionAsset } from "@/lib/production/types";
import {
  allCharacterVoiceIterations,
  displayedCharacterVoice,
} from "@/lib/studio/character-voice-designs";
import type { BibleIndexRow } from "@/lib/studio/movie-bible";
import { useStudio } from "@/lib/studio/store";
import type { Picture } from "@/lib/studio/types";
import { AssetImagePreview } from "./asset-image-preview";
import { CabinetModal } from "./cabinet";
import { CharacterVoiceSamples } from "./character-voice-samples";
import { useWorkspaceDraft } from "./use-workspace-draft";
import { openAssetIterations } from "./workspace-links";
import "./character-media-panel.css";

type CharacterMedia = {
  key: string;
  id: string;
  name: string;
  uri: string;
  previewUri?: string;
  mediaType: string;
  origin: "iteration" | "reference" | "board";
  label: string;
  approved: boolean;
};

function characterMedia(
  picture: Picture,
  characterId: string,
  asset?: ProductionAsset,
): CharacterMedia[] {
  const referenceSlotIds = new Set(
    picture.visualDevelopment?.characterBibles
      .filter((bible) => bible.characterId === characterId)
      .flatMap((bible) => bible.referenceSlotIds) ?? [],
  );
  const slots = picture.visualDevelopment?.boards.flatMap((board) => board.referenceSlots) ?? [];
  return [
    ...[...(asset?.iterations ?? [])].reverse().map((iteration, index): CharacterMedia => {
      const approved =
        iteration.id === asset?.approvedIterationId && iteration.status === "APPROVED";
      return {
        key: `iteration:${iteration.id}`,
        id: iteration.id,
        name:
          iteration.uploadedFileName ||
          `Image iteration ${(asset?.iterations.length ?? 0) - index}`,
        uri: iteration.mediaUri,
        previewUri: iteration.previewUri,
        mediaType: "image",
        origin: "iteration",
        approved,
        label: approved
          ? "Approved image selection"
          : iteration.status === "APPROVED"
            ? "Previous approval · not selected"
            : iteration.status === "REJECTED"
              ? "Rejected iteration"
              : iteration.status === "STALE"
                ? "Source changed · review needed"
                : "Unapproved iteration",
      };
    }),
    ...(asset?.references ?? []).map((reference): CharacterMedia => ({
      key: `reference:${reference.id}`,
      id: reference.id,
      name: reference.name,
      uri: reference.uri,
      previewUri: reference.previewUri,
      mediaType: reference.mediaType,
      origin: "reference",
      approved: false,
      label: reference.preferred ? "Preferred design reference" : "Design reference",
    })),
    ...[...referenceSlotIds].map((id): CharacterMedia => {
      const slot = slots.find((item) => item.id === id);
      return {
        key: `board:${id}`,
        id,
        name: slot?.label ?? `Missing reference slot: ${id}`,
        uri: slot?.uri ?? "",
        mediaType: "image",
        origin: "board",
        approved: false,
        label: slot ? "Linked visual Bible reference" : "Reference slot could not be resolved",
      };
    }),
  ];
}

function ReferencePreview({
  item,
  name,
  onRepair,
  expanded = false,
}: {
  item: CharacterMedia;
  name: string;
  onRepair?: () => void;
  expanded?: boolean;
}) {
  if (item.mediaType.startsWith("audio"))
    return (
      <audio
        controls
        preload="metadata"
        src={item.previewUri ?? item.uri}
        aria-label={`${name} reference ${item.name}`}
        className="character-media-audio"
      />
    );
  if (item.mediaType.startsWith("video"))
    return (
      <video
        controls
        preload="metadata"
        src={item.previewUri ?? item.uri}
        aria-label={`${name} reference ${item.name}`}
        className="character-media-image"
      />
    );
  if (!item.mediaType.startsWith("image"))
    return (
      <p className="character-media-note">
        This reference is {item.mediaType || "an unspecified media type"}. Open its asset record to
        inspect the source.
      </p>
    );
  return (
    <AssetImagePreview
      previewUri={item.previewUri}
      mediaUri={item.uri}
      alt={`${name} — ${item.name}`}
      className={`character-media-image${expanded ? " character-media-image-expanded" : ""}`}
      onRepair={onRepair}
    />
  );
}

/** Identity media and review controls use the existing production/voice records. */
export function CharacterMediaPanel({
  picture,
  record,
  asset,
}: {
  picture: Picture;
  record: BibleIndexRow;
  asset?: ProductionAsset;
}) {
  const [selection, setSelection] = useWorkspaceDraft<string>(
    `character-media-selection:${record.id}`,
    "",
  );
  const [modal, setModal] = useState<{
    recordId: string;
    kind: "preview" | "import" | "voice";
  } | null>(null);
  const [failedVoice, setFailedVoice] = useState<Record<string, string[]>>({});
  const importBaseline = useRef(picture.production);
  importBaseline.current = picture.production;
  const media = characterMedia(picture, record.id, asset);
  const selected =
    media.find((item) => item.key === selection) ??
    media.find((item) => item.approved) ??
    media.find((item) => item.origin === "iteration") ??
    media.find((item) => item.label === "Preferred design reference") ??
    media[0];
  const selectedIndex = selected ? media.findIndex((item) => item.key === selected.key) : 0;
  const pageStart = Math.floor(selectedIndex / 3) * 3;
  const voiceIterations = asset
    ? allCharacterVoiceIterations(picture).filter((voice) => voice.characterId === asset.id)
    : [];
  const voice = asset ? displayedCharacterVoice(picture, asset.id, null) : undefined;
  const audition = voice?.approved ?? voice?.selected;
  const audioUri =
    audition?.audio &&
    [audition.audio.previewUri, audition.audio.mediaUri].find(
      (uri) => uri && !failedVoice[audition.id]?.includes(uri),
    );
  const requirements =
    asset?.canonicalSpec.referenceRequirements?.filter((value) => value.trim()) ?? [];
  const isOpen = (kind: NonNullable<typeof modal>["kind"]) =>
    modal?.recordId === record.id && modal.kind === kind;
  const open = (kind: NonNullable<typeof modal>["kind"]) => setModal({ recordId: record.id, kind });
  const openInventory = () => {
    if (asset) openAssetIterations(picture.id, asset.id);
    else useStudio.getState().openAdvancedDepartment("inventory");
  };
  const openVisualDevelopment = () => {
    const store = useStudio.getState();
    const latest = store.pictures.find((item) => item.id === picture.id);
    if (!latest) return;
    store.replaceActive({
      ...latest,
      workspacePanel: null,
      editorDrafts: { ...latest.editorDrafts, "characters-workspace-view": "visual" },
    });
    store.openAdvancedDepartment("visual-development");
  };
  const repairSelected = () =>
    selected?.origin === "board"
      ? openVisualDevelopment()
      : asset
        ? open("import")
        : openInventory();

  return (
    <aside
      className="character-media-panel"
      aria-label={`${record.name} visual and voice references`}
    >
      <section
        className="character-media-section"
        aria-labelledby={`character-visual-${record.id}`}
      >
        <div className="character-media-heading">
          <h3 id={`character-visual-${record.id}`}>
            <Images size={16} aria-hidden="true" /> Visual identity
          </h3>
          <span className="character-media-count" aria-label={`${media.length} media records`}>
            {media.length}
          </span>
        </div>
        {selected ? (
          <>
            <div className="character-media-portrait">
              <ReferencePreview item={selected} name={record.name} onRepair={repairSelected} />
              <Button
                variant="secondary"
                size="icon-sm"
                className="character-media-expand"
                aria-label={`Enlarge ${selected.name}`}
                title="Open full reference"
                onClick={() => open("preview")}
              >
                <Expand size={15} />
              </Button>
            </div>
            <div className="character-media-caption" aria-live="polite">
              <strong>{selected.name}</strong>
              <span
                className={selected.approved ? "character-media-approved" : "character-media-note"}
              >
                {selected.approved && <Check size={13} aria-hidden="true" />}
                {selected.label}
              </span>
            </div>
            {media.length > 1 && (
              <div
                className="character-media-carousel"
                aria-label="Character reference carousel"
                aria-roledescription="carousel"
              >
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Previous character reference"
                  disabled={selectedIndex === 0}
                  onClick={() => setSelection(media[selectedIndex - 1].key)}
                >
                  <ChevronLeft size={16} />
                </Button>
                <div className="character-media-thumbnails">
                  {media.slice(pageStart, pageStart + 3).map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className="character-media-thumbnail"
                      aria-label={`View ${item.name}: ${item.label}`}
                      aria-pressed={selected?.key === item.key}
                      title={`${item.name} · ${item.label}`}
                      onClick={() => setSelection(item.key)}
                    >
                      {item.mediaType.startsWith("image") ? (
                        <AssetImagePreview
                          previewUri={item.previewUri}
                          mediaUri={item.uri}
                          alt={item.name}
                          className="character-media-thumbnail-image"
                        />
                      ) : (
                        <Images size={18} aria-hidden="true" />
                      )}
                      {item.approved && (
                        <span
                          className="character-media-approved-dot"
                          aria-label="Approved selection"
                        >
                          <Check size={10} />
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Next character reference"
                  disabled={selectedIndex >= media.length - 1}
                  onClick={() => setSelection(media[selectedIndex + 1].key)}
                >
                  <ChevronRight size={16} />
                </Button>
                <span className="character-media-carousel-count" aria-live="polite">
                  {selectedIndex + 1} / {media.length}
                </span>
              </div>
            )}
          </>
        ) : (
          <div className="character-media-empty">
            <ImagePlus size={22} aria-hidden="true" />
            <div>
              <strong>No visual reference attached</strong>
              <p>Attach established identity views to compare face, body and silhouette.</p>
            </div>
          </div>
        )}
        <div className="character-media-actions">
          {asset && (
            <Button variant="secondary" size="sm" onClick={() => open("import")}>
              <Upload size={14} /> Import images
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={openInventory}>
            {asset ? "Review images" : "Open asset library"}
            <ArrowUpRight size={14} />
          </Button>
          {media.some((item) => item.origin === "board") && (
            <Button variant="ghost" size="sm" onClick={openVisualDevelopment}>
              Visual Bible references
              <ArrowUpRight size={14} />
            </Button>
          )}
        </div>
        {asset && (
          <p className="character-media-note">
            {asset.canonicalApproved ? "Specification approved" : "Specification awaiting approval"}
            {asset.stale ? " · source changed" : ""}.{" "}
            {asset.approvedIterationId
              ? "Image selection is tracked separately."
              : "No approved image selected."}
          </p>
        )}
        {!asset && (
          <p className="character-media-note">
            This character has no linked production asset. Production image approvals are not yet
            available.
          </p>
        )}
        <div className="character-media-requirements">
          <div className="character-media-subheading">
            <h4>
              {requirements.length ? "Required reference views" : "Bible reference checklist"}
            </h4>
            <span>Coverage unverified</span>
          </div>
          {requirements.length ? (
            <ul>
              {requirements.map((requirement, index) => (
                <li key={`${index}:${requirement}`}>
                  <Circle size={11} aria-hidden="true" />
                  <span>{requirement}</span>
                </li>
              ))}
            </ul>
          ) : (
            <>
              <div
                className="character-media-angles"
                aria-label="Bible visual reference requirements"
              >
                {["Front", "Three-quarter", "Profile", "Full body", "Hands & features"].map(
                  (angle) => (
                    <span key={angle}>
                      <Circle size={9} aria-hidden="true" />
                      {angle}
                    </span>
                  ),
                )}
              </div>
              <p className="character-media-note">
                Verify relevant angles against the source. A file attachment does not establish
                identity approval.
              </p>
            </>
          )}
        </div>
      </section>

      <section
        className="character-media-section character-media-voice"
        aria-labelledby={`character-voice-${record.id}`}
      >
        <div className="character-media-heading">
          <h3 id={`character-voice-${record.id}`}>
            <Mic2 size={16} aria-hidden="true" /> Voice identity
          </h3>
          <span
            className="character-media-count"
            aria-label={`${voiceIterations.length} voice iterations`}
          >
            {voiceIterations.length}
          </span>
        </div>
        <div className="character-media-voice-status">
          <span className={voice?.approved ? "character-media-approved" : "character-media-note"}>
            {voice?.approved ? (
              <>
                <Check size={13} />
                Approved voice selection
              </>
            ) : (
              "No approved voice selected"
            )}
          </span>
          {audition && <strong>{audition.name}</strong>}
        </div>
        {audition?.audio ? (
          <>
            {!voice?.approved && (
              <p className="character-media-note">Audition preview · awaiting approval</p>
            )}
            {audioUri ? (
              <audio
                key={`${audition.id}:${audioUri}`}
                controls
                preload="metadata"
                src={audioUri}
                aria-label={`${voice?.approved ? "Approved voice" : "Voice audition"} for ${record.name}`}
                className="character-media-audio"
                onError={() =>
                  setFailedVoice((current) => ({
                    ...current,
                    [audition.id]: [...(current[audition.id] ?? []), audioUri],
                  }))
                }
              />
            ) : (
              <>
                <p role="alert" className="character-media-error">
                  Preview and original recording are unavailable. Open voice iterations to inspect
                  or replace this reference.
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setFailedVoice((current) => ({ ...current, [audition.id]: [] }))}
                >
                  Retry recording
                </Button>
              </>
            )}
          </>
        ) : (
          <p className="character-media-note">
            {asset
              ? "Import an audition or develop a voice reference, then review and approve its identity."
              : "Link a character production asset before assigning an approved voice."}
          </p>
        )}
        {voice?.selectionIssue && voiceIterations.length > 0 && (
          <p className="character-media-note">{voice.selectionIssue}</p>
        )}
        {asset && (
          <Button
            variant="secondary"
            size="sm"
            className="character-media-voice-action"
            onClick={() => open("voice")}
          >
            <Mic2 size={14} />
            Voice & auditions
            <ArrowUpRight size={14} />
          </Button>
        )}
      </section>

      <CabinetModal
        title={`${record.name} · reference preview`}
        open={isOpen("preview")}
        onOpenChange={(value) => !value && setModal(null)}
      >
        {selected && (
          <div className="character-media-full-preview">
            <ReferencePreview
              item={selected}
              name={record.name}
              expanded
              onRepair={repairSelected}
            />
            <div className="character-media-caption">
              <strong>{selected.name}</strong>
              <p>{selected.label}</p>
              <p className="character-media-note">Record: {selected.id}</p>
            </div>
            <div className="character-media-actions">
              <Button
                variant="secondary"
                onClick={selected.origin === "board" ? openVisualDevelopment : openInventory}
              >
                {selected.origin === "board" ? "Open visual Bible" : "Open image review"}
                <ArrowUpRight size={16} />
              </Button>
              {asset && selected.origin !== "board" && (
                <Button variant="ghost" onClick={() => open("import")}>
                  Import or repair reference
                </Button>
              )}
            </div>
          </div>
        )}
      </CabinetModal>
      <CabinetModal
        title={`${record.name} · import visual references`}
        open={isOpen("import")}
        onOpenChange={(value) => !value && setModal(null)}
      >
        {asset && picture.production && (
          <div className="character-media-import">
            <p>
              Choose an image iteration or a design reference. Review the result before using it as
              an approved identity.
            </p>
            <AssetReferenceUpload
              record={picture.production}
              assetId={asset.id}
              onChange={(production) => {
                const store = useStudio.getState();
                const latest = store.pictures.find((item) => item.id === picture.id);
                if (!latest || latest.production !== importBaseline.current) {
                  toast.error(
                    "The production record changed during this import. Retry with the current record.",
                  );
                  return;
                }
                importBaseline.current = production;
                store.replaceActive({ ...latest, production, updatedAt: Date.now() });
              }}
            />
            <Button variant="ghost" onClick={openInventory}>
              Open all image iterations
              <ArrowUpRight size={16} />
            </Button>
          </div>
        )}
      </CabinetModal>
      <CabinetModal
        title={`${record.name} · voice design & auditions`}
        open={isOpen("voice")}
        onOpenChange={(value) => !value && setModal(null)}
      >
        {asset && (
          <>
            {voice?.approved && (
              <p className="character-media-note">
                Approved reference: {voice.approved.id} · revision {voice.approved.revision ?? 0}
                {voice.approved.design?.language ? ` · ${voice.approved.design.language}` : ""}
              </p>
            )}
            <CharacterVoiceSamples pictureId={picture.id} characterId={asset.id} expanded />
          </>
        )}
      </CabinetModal>
    </aside>
  );
}
