import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, PanelLeft, PanelRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Bin } from "./bin";
import { Inspector } from "./inspector";
import { InterfaceScale } from "./interface-scale";
import { StageRail, StageView } from "./stage-views";
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

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function useViewportWidth() {
  const [width, setWidth] = useState(() => typeof window === "undefined" ? 1440 : window.innerWidth);
  useEffect(() => {
    const update = () => setWidth(window.innerWidth);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return width;
}

function Drawer({ side, title, children, onClose }: { side: "left" | "right"; title: string; children: ReactNode; onClose: () => void }) {
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
      <button type="button" className="absolute inset-0 cursor-default" aria-label={`Close ${title}`} onClick={onClose} />
      <section ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={`absolute inset-y-0 ${side === "left" ? "left-0 border-r" : "right-0 border-l"} flex w-[min(22rem,88vw)] min-w-0 flex-col border-border bg-surface shadow-2xl outline-none`}>
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
          <p className="text-[11px] tracking-wide text-subtle uppercase">{title}</p>
          <Button size="icon-sm" variant="ghost" aria-label={`Close ${title}`} onClick={onClose}><X /></Button>
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
  const uiMode = useStudio((state) => state.uiMode);
  const advancedSurface = useStudio((state) => state.advancedSurface);
  const closePicture = useStudio((state) => state.closePicture);
  const leftCollapsed = useStudio((state) => state.leftPanelCollapsed);
  const rightCollapsed = useStudio((state) => state.rightPanelCollapsed);
  const setLeftCollapsed = useStudio((state) => state.setLeftPanelCollapsed);
  const setRightCollapsed = useStudio((state) => state.setRightPanelCollapsed);
  const [leftDrawer, setLeftDrawer] = useState(false);
  const [rightDrawer, setRightDrawer] = useState(false);
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

  const columns = [
    layout.left ? "clamp(13.75rem,18vw,20rem)" : null,
    "minmax(0,1fr)",
    layout.right ? "clamp(17.5rem,21vw,24rem)" : null,
  ].filter(Boolean).join(" ");

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
      data-ui-mode={uiMode}
      data-advanced-surface={advancedSurface}
      data-left-panel={leftKind ?? "none"}
      data-right-panel={rightKind ?? "none"}
      className="flex h-dvh min-h-0 min-w-0 max-w-full flex-col overflow-hidden bg-bg"
    >
      <header className="relative z-30 flex min-w-0 shrink-0 items-center gap-1 border-b border-border px-2 py-1.5 sm:gap-2 sm:px-3 sm:py-2">
        <Button variant="ghost" size="icon-sm" onClick={closePicture} aria-label="Back to pictures"><ArrowLeft /></Button>
        {leftKind ? <Button variant="ghost" size="icon-sm" aria-label={layout.left ? `Collapse ${leftTitle}` : `Open ${leftTitle}`} title={layout.left ? `Collapse ${leftTitle}` : `Open ${leftTitle}`} onClick={toggleLeft}><PanelLeft /></Button> : null}
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-base leading-tight tracking-tight sm:text-lg" title={picture.title}>{picture.title}</p>
          <p className="hidden truncate text-[10px] font-light text-subtle xl:block">Local model vault · V3.02 · no ComfyUI</p>
        </div>
        {leftKind && !layout.left && leftCollapsed && layout.mode !== "narrow" ? <Button className="hidden xl:inline-flex" size="sm" variant="ghost" onClick={() => setLeftCollapsed(false)}>{leftTitle}</Button> : null}
        {rightKind && !layout.right && rightCollapsed && layout.mode === "wide" ? <Button className="hidden xl:inline-flex" size="sm" variant="ghost" onClick={() => setRightCollapsed(false)}>{rightTitle}</Button> : null}
        <InterfaceScale />
        {rightKind ? <Button variant="ghost" size="icon-sm" aria-label={layout.right ? `Collapse ${rightTitle}` : `Open ${rightTitle}`} title={layout.right ? `Collapse ${rightTitle}` : `Open ${rightTitle}`} onClick={toggleRight}><PanelRight /></Button> : null}
      </header>

      <div className="relative z-20 min-w-0 shrink-0 border-b border-border"><StageRail /></div>

      <div
        className="grid min-h-0 min-w-0 flex-1 overflow-hidden"
        style={{
          gridTemplateColumns: columns,
          gridTemplateRows: showTimeline ? "minmax(0, 1fr) clamp(6rem, 18vh, 11rem)" : "minmax(0, 1fr)",
        }}
      >
        {layout.left && leftKind ? <div className="min-h-0 min-w-0 overflow-hidden border-r border-border"><LeftPanel kind={leftKind} /></div> : null}
        <main className="min-h-0 min-w-0 overflow-hidden bg-bg"><StageView /></main>
        {layout.right && rightKind ? <div className="min-h-0 min-w-0 overflow-hidden border-l border-border"><RightPanel kind={rightKind} /></div> : null}
        {showTimeline ? <div className="min-h-0 min-w-0 overflow-hidden border-t border-border" style={{ gridColumn: "1 / -1" }}><Timeline /></div> : null}
      </div>

      {leftDrawer && leftKind ? <Drawer side="left" title={leftTitle} onClose={closeLeftDrawer}><LeftPanel kind={leftKind} /></Drawer> : null}
      {rightDrawer && rightKind ? <Drawer side="right" title={rightTitle} onClose={closeRightDrawer}><RightPanel kind={rightKind} /></Drawer> : null}
    </div>
  );
}
