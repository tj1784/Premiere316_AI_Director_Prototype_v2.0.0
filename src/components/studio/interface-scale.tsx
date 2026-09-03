import { useEffect, useRef, useState } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { desktopZoomGet, desktopZoomSet, desktopZoomSubscribe, isDesktopApp } from "@/lib/desktop/client";

const STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.33, 1.5, 1.75, 2] as const;

export function InterfaceScale() {
  const [desktop, setDesktop] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const available = isDesktopApp();
    setDesktop(available);
    if (!available) return;
    void desktopZoomGet().then(setZoom);
    return desktopZoomSubscribe(setZoom);
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  if (!desktop) return null;
  const index = STEPS.reduce((best, value, i) => Math.abs(value - zoom) < Math.abs(STEPS[best] - zoom) ? i : best, 0);
  const update = (next: number) => void desktopZoomSet(next).then(setZoom);

  return (
    <div className="relative" ref={root}>
      <Button size="sm" variant="ghost" className="px-2 tabular-nums" aria-expanded={open} aria-haspopup="dialog" title="Interface scale (Ctrl + / - / 0)" onClick={() => setOpen((value) => !value)}>
        {Math.round(zoom * 100)}%
      </Button>
      {open ? (
        <div role="dialog" aria-label="Interface scale" className="absolute right-0 top-full z-50 mt-2 w-52 rounded-lg bg-elevated p-3 shadow-[0_12px_32px_rgba(0,0,0,0.45),var(--shadow-border)]">
          <p className="text-[11px] tracking-wide text-subtle uppercase">Interface scale</p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <Button size="icon-sm" variant="secondary" aria-label="Zoom out" disabled={index === 0} onClick={() => update(STEPS[Math.max(0, index - 1)])}><Minus /></Button>
            <span className="min-w-14 text-center text-sm tabular-nums">{Math.round(zoom * 100)}%</span>
            <Button size="icon-sm" variant="secondary" aria-label="Zoom in" disabled={index === STEPS.length - 1} onClick={() => update(STEPS[Math.min(STEPS.length - 1, index + 1)])}><Plus /></Button>
          </div>
          <Button className="mt-2 w-full" size="sm" variant="ghost" onClick={() => update(1)}><RotateCcw /> Actual size</Button>
          <p className="mt-2 text-[10px] leading-relaxed text-subtle">Ctrl + / − to scale · Ctrl 0 to reset</p>
        </div>
      ) : null}
    </div>
  );
}
