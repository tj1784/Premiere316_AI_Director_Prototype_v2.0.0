import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, PanelLeft, PanelRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Bin } from "./bin";
import { Inspector } from "./inspector";
import { InterfaceScale } from "./interface-scale";
import { StillBay } from "./still-bay";
import { StageRail, StageView } from "./stage-views";
import { Timeline } from "./timeline";
import { useActivePicture, useStage, useStudio } from "@/lib/studio/store";
import { useDirector } from "@/lib/studio/use-director";
import { dockedPanels, showTimelineForStage } from "@/lib/studio/responsive-layout";
import { MODEL_ROOT } from "@/lib/studio/types";

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
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 bg-bg/70" role="presentation">
      <button type="button" className="absolute inset-0 cursor-default" aria-label={`Close ${title}`} onClick={onClose} />
      <section role="dialog" aria-modal="true" aria-label={title} className={`absolute inset-y-0 ${side === "left" ? "left-0 border-r" : "right-0 border-l"} flex w-[min(22rem,88vw)] min-w-0 flex-col border-border bg-surface shadow-2xl`}>
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
          <p className="text-[11px] tracking-wide text-subtle uppercase">{title}</p>
          <Button size="icon-sm" variant="ghost" aria-label={`Close ${title}`} onClick={onClose}><X /></Button>
        </header>
        <div className="min-h-0 flex-1">{children}</div>
      </section>
    </div>
  );
}

export function StudioShell() {
  const picture = useActivePicture();
  const stage = useStage();
  const closePicture = useStudio((s) => s.closePicture);
  const stillBayShotId = useStudio((s) => s.stillBayShotId);
  const leftCollapsed = useStudio((s) => s.leftPanelCollapsed);
  const rightCollapsed = useStudio((s) => s.rightPanelCollapsed);
  const setLeftCollapsed = useStudio((s) => s.setLeftPanelCollapsed);
  const setRightCollapsed = useStudio((s) => s.setRightPanelCollapsed);
  const [leftDrawer, setLeftDrawer] = useState(false);
  const [rightDrawer, setRightDrawer] = useState(false);
  const width = useViewportWidth();
  const layout = dockedPanels(width, { leftCollapsed, rightCollapsed });
  const showTimeline = showTimelineForStage(stage);
  const { busy, compose } = useDirector();
  if (!picture) return null;

  const columns = [layout.left ? "clamp(13.75rem,18vw,20rem)" : null, "minmax(0,1fr)", layout.right ? "clamp(17.5rem,21vw,24rem)" : null]
    .filter(Boolean)
    .join(" ");
  const toggleLeft = () => layout.mode === "narrow" ? setLeftDrawer(true) : setLeftCollapsed(!leftCollapsed);
  const toggleRight = () => layout.mode === "wide" ? setRightCollapsed(!rightCollapsed) : setRightDrawer(true);

  return (
    <div className="flex h-dvh min-h-0 min-w-0 flex-col overflow-hidden bg-bg">
      <header className="relative z-30 flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5 sm:gap-2 sm:px-3 sm:py-2">
        <Button variant="ghost" size="icon-sm" onClick={closePicture} aria-label="Back to pictures"><ArrowLeft /></Button>
        <Button variant="ghost" size="icon-sm" aria-label={layout.left ? "Collapse Bin" : "Open Bin"} title={layout.left ? "Collapse Bin" : "Open Bin"} onClick={toggleLeft}><PanelLeft /></Button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-base leading-tight tracking-tight sm:text-lg" title={picture.title}>{picture.title}</p>
          <p className="hidden truncate text-[10px] font-light text-subtle sm:block" title={MODEL_ROOT}>{MODEL_ROOT} · V3.02 · no ComfyUI</p>
        </div>
        {!layout.left && leftCollapsed && layout.mode !== "narrow" ? <Button className="hidden xl:inline-flex" size="sm" variant="ghost" onClick={() => setLeftCollapsed(false)}>Bin</Button> : null}
        {!layout.right && rightCollapsed && layout.mode === "wide" ? <Button className="hidden xl:inline-flex" size="sm" variant="ghost" onClick={() => setRightCollapsed(false)}>Inspector</Button> : null}
        <InterfaceScale />
        <Button variant="ghost" size="icon-sm" aria-label={layout.right ? "Collapse Inspector" : "Open Inspector"} title={layout.right ? "Collapse Inspector" : "Open Inspector"} onClick={toggleRight}><PanelRight /></Button>
        <Button className="hidden sm:inline-flex" size="sm" variant="secondary" disabled={busy === "compose" || !picture.logline} onClick={compose}>{busy === "compose" ? "Writing…" : "Rewrite"}</Button>
      </header>
      <div className="relative z-20 shrink-0 border-b border-border"><StageRail /></div>

      <div
        className="grid min-h-0 min-w-0 flex-1"
        style={{
          gridTemplateColumns: columns,
          gridTemplateRows: showTimeline ? "minmax(0, 1fr) clamp(6rem, 18vh, 11rem)" : "minmax(0, 1fr)",
        }}
      >
        {layout.left ? <div className="min-h-0 min-w-0 overflow-hidden border-r border-border"><Bin /></div> : null}
        <main className="min-h-0 min-w-0 overflow-hidden bg-bg"><StageView /></main>
        {layout.right ? <div className="min-h-0 min-w-0 overflow-hidden border-l border-border"><Inspector /></div> : null}
        {showTimeline ? <div className="min-h-0 min-w-0 overflow-hidden border-t border-border" style={{ gridColumn: "1 / -1" }}><Timeline /></div> : null}
      </div>

      {leftDrawer ? <Drawer side="left" title="Bin" onClose={() => setLeftDrawer(false)}><Bin /></Drawer> : null}
      {rightDrawer ? <Drawer side="right" title="Inspector" onClose={() => setRightDrawer(false)}><Inspector /></Drawer> : null}
      {stillBayShotId ? <StillBay /> : null}
    </div>
  );
}
