import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  FolderOpen,
  PanelLeft,
  PanelRight,
  X,
  Maximize2,
  Minimize2,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import "./nonmodal-shell-and-script.css";
import "./ps5-canvas.css";
import { ProductionProfileControls } from "./production-profile-controls";
import { ProjectFiles } from "./project-files";
import { ProjectSaveStatus } from "./project-save-status";
import { Bin } from "./bin";
import { Inspector } from "./inspector";
import { InterfaceScale } from "./interface-scale";
import { StageView } from "./stage-views";
import { WorkspaceNavigation } from "./workspace-navigation";
import { MovieBibleEditor } from "./movie-bible-editor";
import { BibleRunWorkspace } from "./bible-run-workspace";
import { ClipInspector, MediaBin } from "./stitch-panels";
import { Timeline } from "./timeline";
import { useActivePicture, useStage, useStudio } from "@/lib/studio/store";
import { showTimelineForStage } from "@/lib/studio/responsive-layout";
import {
  resolveStageLayout,
  shellLeftKind,
  shellLeftTitle,
  shellRightKind,
  shellRightTitle,
  type ShellLeftKind,
  type ShellRightKind,
} from "@/lib/studio/stage-layout";

function ContextPanel({
  side,
  title,
  children,
  onClose,
}: {
  side: "left" | "right";
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const region = useRef<HTMLElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    region.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [onClose]);

  return (
    <section
      ref={region}
      id="studio-side-panel"
      tabIndex={-1}
      role="region"
      aria-label={title}
      className={`studio-context-panel studio-context-panel-${side}`}
    >
      <header className="studio-context-heading">
        <h2>{title}</h2>
        <Button size="icon-sm" variant="ghost" aria-label={`Close ${title}`} onClick={onClose}>
          <X aria-hidden="true" />
        </Button>
      </header>
      <div className="studio-context-body">{children}</div>
    </section>
  );
}

function LeftPanel({ kind }: { kind: ShellLeftKind }) {
  return kind === "media" ? <MediaBin /> : <Bin />;
}

function RightPanel({ kind }: { kind: ShellRightKind }) {
  return kind === "clip" ? <ClipInspector /> : <Inspector />;
}

export function StudioShell() {
  const picture = useActivePicture();
  const stage = useStage();
  const uiMode = useStudio((s) => s.uiMode);
  const advancedSurface = useStudio((s) => s.advancedSurface);
  const [expanded, setExpanded] = useState(false);
  const [failedAmbient, setFailedAmbient] = useState<string[]>([]);
  const [panel, setPanel] = useState<"left" | "right" | "files" | "settings" | null>(null);
  const closePanel = useCallback(() => setPanel(null), []);
  const togglePanel = (next: NonNullable<typeof panel>) =>
    setPanel((current) => (current === next ? null : next));
  useEffect(() => {
    const restore = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", restore);
    return () => window.removeEventListener("keydown", restore);
  }, []);
  useEffect(() => {
    setPanel(null);
  }, [stage, picture?.workspacePanel]);
  if (!picture) return null;
  const workspacePanel = picture.workspacePanel;
  const layoutStage =
    uiMode === "advanced" && advancedSurface === "dashboard" ? "dashboard" : stage;
  const policy = resolveStageLayout(layoutStage);
  const leftKind = shellLeftKind(policy);
  const rightKind = shellRightKind(policy);
  const showTimeline = showTimelineForStage(layoutStage) && !workspacePanel && !expanded;
  const ambientImage = [
    picture.shots.find((shot) => shot.stillUrl)?.stillUrl,
    picture.id === "pic_prodigal_son_20260909"
      ? "/pictures/prodigal-son/previews/PS-S18-SH005-FIRST.webp"
      : null,
    picture.thumbnailUrl,
  ].find((uri) => uri && !failedAmbient.includes(uri));
  return (
    <div
      data-studio-shell="true"
      data-stage={layoutStage}
      data-editor-expanded={expanded}
      data-ui-mode={uiMode}
      data-advanced-surface={advancedSurface}
      className="studio-desktop"
    >
      {ambientImage && (
        <div className="studio-ambient-art" aria-hidden="true">
          <img src={ambientImage} alt="" onError={() => setFailedAmbient((previous) => [...previous, ambientImage])} />
        </div>
      )}
      <header className="studio-titlebar">
        <div className="studio-project-identity">
          <button
            className="studio-project-switch"
            aria-label="Home · movie scripts"
            title="Home · movie scripts"
            onClick={() => useStudio.getState().closePicture()}
          >
            <ArrowLeft size={16} />
            <span className="studio-brand-name">Premiere316</span>
            <span className="studio-project-mobile">{picture.title}</span>
          </button>
          <ProjectSaveStatus />
        </div>
        {!expanded && <WorkspaceNavigation />}
        <div className="studio-title-actions">
          <span className="studio-project-caption" title={picture.title}>
            {picture.title}
          </span>
          {!workspacePanel && leftKind && (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Open ${shellLeftTitle(leftKind)}`}
              title={shellLeftTitle(leftKind)}
              aria-expanded={panel === "left"}
              aria-controls="studio-side-panel"
              onClick={() => togglePanel("left")}
            >
              <PanelLeft size={17} />
            </Button>
          )}
          {!workspacePanel && rightKind && (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Open ${shellRightTitle(rightKind)}`}
              title={shellRightTitle(rightKind)}
              aria-expanded={panel === "right"}
              aria-controls="studio-side-panel"
              onClick={() => togglePanel("right")}
            >
              <PanelRight size={17} />
            </Button>
          )}
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Project files"
            title="Project files"
            aria-expanded={panel === "files"}
            aria-controls="studio-side-panel"
            onClick={() => togglePanel("files")}
          >
            <FolderOpen size={17} aria-hidden="true" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Project settings"
            title="Project settings"
            aria-expanded={panel === "settings"}
            aria-controls="studio-side-panel"
            onClick={() => togglePanel("settings")}
          >
            <Settings2 size={17} />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={expanded ? "Restore workspace" : "Expand editor"}
            title={expanded ? "Restore workspace" : "Expand editor"}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </Button>
        </div>
      </header>
      <div
        className="studio-canvas"
        data-has-timeline={showTimeline}
        data-has-panel={Boolean(panel)}
      >
        <div className="studio-canvas-body" data-panel-open={Boolean(panel)}>
          {panel === "left" && leftKind && (
            <ContextPanel side="left" title={shellLeftTitle(leftKind)} onClose={closePanel}>
              <LeftPanel kind={leftKind} />
            </ContextPanel>
          )}
          <main>
            {workspacePanel ? (
              <div className="cabinet-workspace-panel">
                {workspacePanel === "bible" ? <MovieBibleEditor /> : <BibleRunWorkspace />}
              </div>
            ) : (
              <StageView />
            )}
          </main>
          {panel === "right" && rightKind && (
            <ContextPanel side="right" title={shellRightTitle(rightKind)} onClose={closePanel}>
              <RightPanel kind={rightKind} />
            </ContextPanel>
          )}
          {panel === "files" && (
            <ContextPanel side="right" title="Project files" onClose={closePanel}>
              <ProjectFiles picture={picture} />
            </ContextPanel>
          )}
          {panel === "settings" && (
            <ContextPanel side="right" title="Project settings" onClose={closePanel}>
              <ProductionProfileControls picture={picture} />
              <InterfaceScale />
            </ContextPanel>
          )}
        </div>
        {showTimeline && (
          <div className="studio-timeline">
            <Timeline />
          </div>
        )}
      </div>
    </div>
  );
}
