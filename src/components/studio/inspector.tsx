import { Button } from "@/components/ui/button";
import { engineById } from "@/lib/studio/engines";
import { useActivePicture, useStudio } from "@/lib/studio/store";
import { SystemContext } from "@/components/studio/system-context";
import { USAGE_CAPS } from "@/lib/studio/types";

export function Inspector() {
  const picture = useActivePicture();
  const selectedShotId = useStudio((state) => state.selectedShotId);
  if (!picture) return null;
  const shot = picture.shots.find((item) => item.id === selectedShotId) ?? picture.shots[0];

  return (
    <aside data-panel-kind="generation" className="flex h-full min-h-0 min-w-0 flex-col bg-surface">
      <div className="px-3 py-3">
        <p className="text-[11px] tracking-wide text-subtle uppercase">Generation inspector</p>
        <h2 className="mt-1 truncate font-display text-xl tracking-tight" title={picture.title}>{picture.title}</h2>
        <p className="mt-1 truncate text-xs text-muted" title={engineById(picture.selectedEngine.image)?.name}>
          Prepared assets · {engineById(picture.selectedEngine.image)?.name}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {shot ? (
          <div className="rounded-md bg-elevated p-3 shadow-[var(--shadow-border)]">
            <p className="text-[11px] text-subtle">
              SHOT {String(shot.index).padStart(2, "0")} · {shot.type} · {shot.durationSec}s
            </p>
            <p className="mt-2 text-sm leading-relaxed">{shot.description}</p>
            <p className="mt-2 text-xs text-muted">{shot.camera} · {shot.lens}</p>
            <p className="mt-1 text-xs text-muted">Move: {shot.cameraMove}</p>
            <p className="mt-2 text-xs"><span className="text-subtle">Face · </span>{shot.expression}</p>
            <Button className="mt-3 w-full" size="sm" variant="secondary" disabled title="Wave 4 generation is prepared-asset-only from the Generate stage.">
              Shot still generation disabled
            </Button>
            <p className="mt-2 text-[10px] leading-relaxed text-subtle">Use Generate for approved prepared assets only. Raw shot stills cannot bypass Inventory 2.0 iteration review.</p>
          </div>
        ) : <p className="text-sm text-muted">Prepare a shot to review generation context.</p>}

        <Usage picture={picture} />
        <SystemContext />
      </div>
    </aside>
  );
}

function Usage({ picture }: { picture: NonNullable<ReturnType<typeof useActivePicture>> }) {
  const rows: [string, number, number][] = [
    ["Director", picture.usage.llm, USAGE_CAPS.llm],
    ["Stills", picture.usage.stills, USAGE_CAPS.stills],
    ["Clips", picture.usage.clips, USAGE_CAPS.clips],
    ["Voice", picture.usage.tts, USAGE_CAPS.tts],
  ];
  return (
    <div className="mt-4 rounded-md bg-elevated p-3">
      <p className="text-[11px] tracking-wide text-subtle uppercase">Project usage</p>
      <ul className="mt-2 grid gap-1">
        {rows.map(([label, count, cap]) => (
          <li key={label} className="flex justify-between text-xs">
            <span>{label}</span>
            <span className="text-subtle tabular-nums">{count}/{cap}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
