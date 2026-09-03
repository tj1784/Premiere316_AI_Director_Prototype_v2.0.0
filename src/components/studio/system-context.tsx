import { useEffect, useState } from "react";
import { desktopBuildInfo, desktopSystemStatus } from "@/lib/desktop/client";
import type { DesktopBuildInfo, SystemStatus } from "@/lib/desktop/protocol";
import { engineById } from "@/lib/studio/engines";
import { formatBytes } from "@/lib/studio/model-catalog";
import { useActivePicture } from "@/lib/studio/store";

export function SystemContext() {
  const picture = useActivePicture();
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [build, setBuild] = useState<DesktopBuildInfo | null>(null);
  useEffect(() => {
    let active = true;
    void desktopBuildInfo().then((next) => {
      if (active) setBuild(next);
    }).catch(() => {
      if (active) setBuild(null);
    });
    const refresh = async () => {
      try {
        const next = await desktopSystemStatus();
        if (active) setStatus(next);
      } catch {
        if (active) setStatus(null);
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);
  if (!picture) return null;
  const engineName = engineById(picture.selectedEngine.image)?.name ?? picture.selectedEngine.image;

  return (
    <div className="mt-4 rounded-md bg-elevated p-3">
      <p className="text-[11px] tracking-wide text-subtle uppercase">System context</p>
      <p className="mt-2 text-xs">{engineName}</p>
      <p className="text-[11px] text-accent">Native standalone adapter</p>
      <p className="mt-1 text-[10px] leading-relaxed text-subtle">
        Open a Still to inspect the exact checkpoint, encoder, tokenizer, VAE, memory footprint, and runtime blockers before generation.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2" aria-label="Live computer status">
        <StatusMeter
          label="CPU"
          value={status ? `${Math.round(status.cpu.utilizationPercent)}%` : "—"}
          percent={status?.cpu.utilizationPercent ?? 0}
          detail={status ? `${status.cpu.logicalCores} threads · ${formatBytes(status.cpu.memoryUsedBytes)} / ${formatBytes(status.cpu.memoryTotalBytes)} RAM` : "Waiting for desktop"}
        />
        <StatusMeter
          label="GPU"
          value={status?.gpu.available ? `${Math.round(status.gpu.utilizationPercent ?? 0)}%` : "—"}
          percent={status?.gpu.utilizationPercent ?? 0}
          detail={
            status?.gpu.available
              ? `${formatBytes(status.gpu.memoryUsedBytes ?? 0)} / ${formatBytes(status.gpu.memoryTotalBytes ?? 0)} VRAM · ${Math.round(status.gpu.temperatureC ?? 0)}°C · ${Math.round(status.gpu.powerWatts ?? 0)}W`
              : "NVIDIA status unavailable"
          }
        />
      </div>
      {build ? (
        <details className="mt-3 border-t border-border pt-2 text-[10px] text-subtle">
          <summary className="cursor-pointer select-none text-muted">Build diagnostics</summary>
          <dl className="mt-2 grid gap-1">
            <Diagnostic label="Version" value={build.appVersion} />
            <Diagnostic label="Build ID" value={build.buildId} />
            <Diagnostic label="Built" value={build.buildTimestamp} />
            <Diagnostic label="Renderer" value={build.rendererMode} />
            <Diagnostic label="Source hash" value={build.rendererSourceHash} />
            <Diagnostic label="Executable" value={build.executablePath} />
            <Diagnostic label="App path" value={build.appPath} />
          </dl>
        </details>
      ) : null}
    </div>
  );
}

function Diagnostic({ label, value }: { label: string; value: string }) {
  return <div className="grid min-w-0 grid-cols-[5rem_minmax(0,1fr)] gap-2"><dt>{label}</dt><dd className="truncate text-fg" title={value}>{value}</dd></div>;
}

function StatusMeter({ label, value, percent, detail }: { label: string; value: string; percent: number; detail: string }) {
  const bounded = Math.max(0, Math.min(100, percent));
  return (
    <div className="rounded-sm bg-inset p-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] tracking-wide text-subtle uppercase">{label}</span>
        <span className="text-xs tabular-nums">{value}</span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-border" role="progressbar" aria-label={`${label} utilization`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(bounded)}>
        <div className="h-full rounded-full bg-accent transition-[width] duration-200 motion-reduce:transition-none" style={{ width: `${bounded}%` }} />
      </div>
      <p className="mt-1 truncate text-[10px] text-subtle" title={detail}>{detail}</p>
    </div>
  );
}
