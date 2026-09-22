import { hydrateProductionRouting } from "@/lib/studio/production-profiles";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, PanelLeft, PanelRight, X, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProjectFiles } from "./project-files";
import { ProjectSaveStatus } from "./project-save-status";
import { Bin } from "./bin";
import { Inspector } from "./inspector";
import { InterfaceScale } from "./interface-scale";
import { StageView } from "./stage-views";
import { WorkspaceNavigation, workspaceGroups } from "./workspace-navigation";
import { MovieBibleEditor } from "./movie-bible-editor";
import { BibleRunWorkspace } from "./bible-run-workspace";
import { useWorkspaceDraft } from "./use-workspace-draft";
import { ClipInspector, MediaBin } from "./stitch-panels";
import { Timeline } from "./timeline";
import { useActivePicture, useStage, useStudio } from "@/lib/studio/store";
import { dockedPanels, showTimelineForStage } from "@/lib/studio/responsive-layout";
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

function useViewportWidth() {
  const [width, setWidth] = useState(() =>
    typeof window === "undefined" ? 1440 : window.innerWidth,
  );
  useEffect(() => {
    const update = () => setWidth(window.innerWidth);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return width;
}

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
  const workspacePanel = picture?.workspacePanel;
  const stage = useStage();
  const uiMode = useStudio((state) => state.uiMode);
  const advancedSurface = useStudio((state) => state.advancedSurface);
  const closePicture = useStudio((state) => state.closePicture);
  const leftCollapsed = useStudio((state) => state.leftPanelCollapsed);
  const rightCollapsed = useStudio((state) => state.rightPanelCollapsed);
  const setLeftCollapsed = useStudio((state) => state.setLeftPanelCollapsed);
  const setRightCollapsed = useStudio((state) => state.setRightPanelCollapsed);
  const [leftDrawer, setLeftDrawer] = useState(false);
  const [rightDrawer, setRightDrawer] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [inspectorWidth, setInspectorWidth] = useWorkspaceDraft("inspector-width", 320);
  const [navHidden, setNavHidden] = useWorkspaceDraft("navigation-collapsed", false);
  useEffect(() => {
    const restore = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", restore);
    return () => window.removeEventListener("keydown", restore);
  }, []);
  const closeLeftDrawer = useCallback(() => setLeftDrawer(false), []);
  const closeRightDrawer = useCallback(() => setRightDrawer(false), []);
  const width = useViewportWidth();
  const showingDashboard = uiMode === "advanced" && advancedSurface === "dashboard";
  const layoutStage = showingDashboard ? "dashboard" : stage;
  const policy = resolveStageLayout(layoutStage);
  const layout = dockedPanels(width, { leftCollapsed, rightCollapsed }, layoutStage);
  const showTimeline = showTimelineForStage(layoutStage);
  const leftKind = shellLeftKind(policy);
  const rightKind = shellRightKind(policy);
  const leftTitle = leftKind ? shellLeftTitle(leftKind) : "";
  const rightTitle = rightKind ? shellRightTitle(rightKind) : "";

  useEffect(() => {
    setLeftDrawer(false);
    setRightDrawer(false);
  }, [stage, uiMode, advancedSurface]);

  if (!picture) return null;
  const routing = hydrateProductionRouting(picture.productionRouting, {
    legacyLocalSelection: Boolean(
      picture.screenplay.pinnedWriterServedId || picture.screenplay.selectedModelId,
    ),
  });

  const columns = [
    layout.left && !workspacePanel && !expanded ? "clamp(13.75rem,18vw,20rem)" : null,
    "minmax(0,1fr)",
    layout.right && !workspacePanel && !expanded
      ? `${Math.max(240, Math.min(480, inspectorWidth))}px`
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  const toggleLeft = () => {
    if (!leftKind) return;
    if (layout.mode === "narrow") {
      setRightDrawer(false);
      setLeftDrawer(true);
      return;
    }
    setLeftCollapsed(!leftCollapsed);
  };

  const toggleRight = () => {
    if (!rightKind) return;
    if (layout.mode === "wide") {
      setRightCollapsed(!rightCollapsed);
      return;
    }
    setLeftDrawer(false);
    setRightDrawer(true);
  };

  return (
    <div
      data-studio-shell="true"
      data-stage={showingDashboard ? "dashboard" : stage}
      data-editor-expanded={expanded}
      data-ui-mode={uiMode}
      data-advanced-surface={advancedSurface}
      data-left-panel={leftKind ?? "none"}
      data-right-panel={rightKind ?? "none"}
      className="flex h-dvh min-h-0 min-w-0 max-w-full flex-col overflow-hidden bg-bg"
    >
      <header className="relative z-30 flex min-w-0 shrink-0 items-center gap-1 border-b border-border px-2 py-1.5 sm:gap-2 sm:px-3 sm:py-2">
        <Button variant="ghost" size="icon-sm" onClick={closePicture} aria-label="Back to pictures">
          <ArrowLeft />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={navHidden ? "Show workspace navigation" : "Collapse workspace navigation"}
          onClick={() => setNavHidden(!navHidden)}
        >
          <PanelLeft />
        </Button>
        {leftKind ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={layout.left ? `Collapse ${leftTitle}` : `Open ${leftTitle}`}
            title={layout.left ? `Collapse ${leftTitle}` : `Open ${leftTitle}`}
            onClick={toggleLeft}
          >
            <PanelLeft />
          </Button>
        ) : null}
        <div className="min-w-0 flex-1">
          <p
            className="truncate font-display text-base leading-tight tracking-tight sm:text-lg"
            title={picture.title}
          >
            {picture.title}
          </p>
          <ProjectSaveStatus />
          <p className="hidden truncate text-xs text-muted xl:block">
            Movie Script /{" "}
            {workspacePanel === "bible"
              ? "Bible & source registry"
              : workspacePanel === "run"
                ? "Script runs & checkpoints"
                : (workspaceGroups.flatMap((g) => g.links).find(([id]) => id === stage)?.[1] ??
                  stage)}{" "}
            · V4 workspace
          </p>
        </div>
        {leftKind && !layout.left && leftCollapsed && layout.mode !== "narrow" ? (
          <Button
            className="hidden xl:inline-flex"
            size="sm"
            variant="ghost"
            onClick={() => setLeftCollapsed(false)}
          >
            {leftTitle}
          </Button>
        ) : null}
        {rightKind && !layout.right && rightCollapsed && layout.mode === "wide" ? (
          <Button
            className="hidden xl:inline-flex"
            size="sm"
            variant="ghost"
            onClick={() => setRightCollapsed(false)}
          >
            {rightTitle}
          </Button>
        ) : null}
        <button
          className="hidden rounded-md border border-border px-3 py-2 text-left text-xs text-muted lg:block"
          aria-label="Open production profile"
          onClick={() => {
            useStudio.getState().patchActive({ workspacePanel: null });
            useStudio.getState().openAdvancedDepartment("intake");
          }}
        >
          <span className="block text-fg">
            {routing.profileId === "astra-ultra" ? "Astra Ultra" : "Local Models"}
          </span>
          <span>
            {routing.executionMode === "autonomous-complete-script"
              ? "Autonomous script"
              : "Step-by-step review"}
          </span>
        </button>
        <ProjectFiles picture={picture} />
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={expanded ? "Restore workspace" : "Expand editor"}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <Minimize2 /> : <Maximize2 />}
        </Button>
        <InterfaceScale />
        {rightKind ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={layout.right ? `Collapse ${rightTitle}` : `Open ${rightTitle}`}
            title={layout.right ? `Collapse ${rightTitle}` : `Open ${rightTitle}`}
            onClick={toggleRight}
          >
            <PanelRight />
          </Button>
        ) : null}
      </header>

      <div className={`workspace-body ${expanded || navHidden ? "workspace-expanded" : ""}`}>
        {!expanded && !navHidden && <WorkspaceNavigation />}
        <div
          className="grid min-h-0 min-w-0 flex-1 overflow-hidden"
          style={{
            gridTemplateColumns: columns,
            gridTemplateRows:
              showTimeline && !workspacePanel && !expanded
                ? "minmax(0, 1fr) clamp(6rem, 18vh, 11rem)"
                : "minmax(0, 1fr)",
          }}
        >
          {layout.left && leftKind && !workspacePanel && !expanded ? (
            <div className="min-h-0 min-w-0 overflow-hidden border-r border-border">
              <LeftPanel kind={leftKind} />
            </div>
          ) : null}
          <main className="min-h-0 min-w-0 overflow-hidden bg-bg">
            {workspacePanel ? (
              <div className="h-full overflow-auto p-4 sm:p-6">
                {workspacePanel === "bible" ? <MovieBibleEditor /> : <BibleRunWorkspace />}
              </div>
            ) : (
              <StageView />
            )}
          </main>
          {layout.right && rightKind && !workspacePanel && !expanded ? (
            <div className="flex min-h-0 min-w-0 flex-col overflow-hidden border-l border-border">
              <label className="flex items-center gap-2 px-3 py-2 text-xs text-muted">
                Inspector width
                <input
                  className="min-w-0 flex-1 accent-accent"
                  aria-label="Inspector width"
                  type="range"
                  min={240}
                  max={480}
                  step={8}
                  value={inspectorWidth}
                  onChange={(e) => setInspectorWidth(Number(e.target.value))}
                />
              </label>
              <div className="min-h-0 flex-1">
                <RightPanel kind={rightKind} />
              </div>
            </div>
          ) : null}
          {showTimeline && !workspacePanel && !expanded ? (
            <div
              className="min-h-0 min-w-0 overflow-hidden border-t border-border"
              style={{ gridColumn: "1 / -1" }}
            >
              <Timeline />
            </div>
          ) : null}
        </div>
      </div>

      {leftDrawer && leftKind ? (
        <Drawer side="left" title={leftTitle} onClose={closeLeftDrawer}>
          <LeftPanel kind={leftKind} />
        </Drawer>
      ) : null}
      {rightDrawer && rightKind ? (
        <Drawer side="right" title={rightTitle} onClose={closeRightDrawer}>
          <RightPanel kind={rightKind} />
        </Drawer>
      ) : null}
    </div>
  );
}
