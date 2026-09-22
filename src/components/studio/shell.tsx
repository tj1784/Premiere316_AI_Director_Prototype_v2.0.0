import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, PanelLeft, PanelRight, X, Maximize2, Minimize2, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CabinetModal } from "./cabinet";
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

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function Drawer({
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
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () => [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    (focusables()[0] ?? panel.current)?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items.length) {
        event.preventDefault();
        panel.current?.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 bg-bg/70" role="presentation">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label={`Close ${title}`}
        onClick={onClose}
      />
      <section
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`absolute inset-y-0 ${side === "left" ? "left-0 border-r" : "right-0 border-l"} flex w-[min(22rem,88vw)] min-w-0 flex-col border-border bg-surface shadow-2xl outline-none`}
      >
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
          <p className="text-[11px] tracking-wide text-subtle uppercase">{title}</p>
          <Button size="icon-sm" variant="ghost" aria-label={`Close ${title}`} onClick={onClose}>
            <X />
          </Button>
        </header>
        <div className="min-h-0 flex-1">{children}</div>
      </section>
    </div>
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
  const [profileOpen, setProfileOpen] = useState(false);
  const [leftDrawer, setLeftDrawer] = useState(false);
  const [rightDrawer, setRightDrawer] = useState(false);
  const closeLeftDrawer = useCallback(() => setLeftDrawer(false), []);
  const closeRightDrawer = useCallback(() => setRightDrawer(false), []);
  useEffect(() => {
    const restore = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", restore);
    return () => window.removeEventListener("keydown", restore);
  }, []);
  useEffect(() => {
    setLeftDrawer(false);
    setRightDrawer(false);
  }, [stage, picture?.workspacePanel]);
  if (!picture) return null;
  const workspacePanel = picture.workspacePanel;
  const layoutStage =
    uiMode === "advanced" && advancedSurface === "dashboard" ? "dashboard" : stage;
  const policy = resolveStageLayout(layoutStage);
  const leftKind = shellLeftKind(policy);
  const rightKind = shellRightKind(policy);
  const showTimeline = showTimelineForStage(layoutStage) && !workspacePanel && !expanded;
  return (
    <div
      data-studio-shell="true"
      data-stage={layoutStage}
      data-editor-expanded={expanded}
      data-ui-mode={uiMode}
      data-advanced-surface={advancedSurface}
      className="studio-desktop"
    >
      <header className="studio-titlebar">
        <div className="studio-project-identity">
        <button
          className="studio-project-switch"
          aria-label="Home · movie scripts"
          onClick={() => useStudio.getState().closePicture()}
        >
          <ArrowLeft size={16} />
          <span>{picture.title}</span>
        </button>
        <ProjectSaveStatus />
        </div>
        {!expanded && <WorkspaceNavigation />}
        <div className="studio-title-actions">
          {!workspacePanel && leftKind && (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Open ${shellLeftTitle(leftKind)}`}
              title={shellLeftTitle(leftKind)}
              onClick={() => setLeftDrawer(true)}
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
              onClick={() => setRightDrawer(true)}
            >
              <PanelRight size={17} />
            </Button>
          )}
          <ProjectFiles picture={picture} iconOnly />
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Project settings"
            title="Project settings"
            onClick={() => setProfileOpen(true)}
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
      <div className="studio-canvas" data-has-timeline={showTimeline}>
        <main>
          {workspacePanel ? (
            <div className="cabinet-workspace-panel">
              {workspacePanel === "bible" ? <MovieBibleEditor /> : <BibleRunWorkspace />}
            </div>
          ) : (
            <StageView />
          )}
        </main>
        {showTimeline && (
          <div className="studio-timeline">
            <Timeline />
          </div>
        )}
      </div>
      <CabinetModal title="Project settings" open={profileOpen} onOpenChange={setProfileOpen}>
        <ProductionProfileControls picture={picture} />
        <InterfaceScale />
      </CabinetModal>
      {leftDrawer && leftKind && (
        <Drawer side="left" title={shellLeftTitle(leftKind)} onClose={closeLeftDrawer}>
          <LeftPanel kind={leftKind} />
        </Drawer>
      )}
      {rightDrawer && rightKind && (
        <Drawer side="right" title={shellRightTitle(rightKind)} onClose={closeRightDrawer}>
          <RightPanel kind={rightKind} />
        </Drawer>
      )}
    </div>
  );
}
