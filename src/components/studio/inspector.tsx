import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { engineById } from "@/lib/studio/engines";
import { useActivePicture, useStudio } from "@/lib/studio/store";
import { useDirector } from "@/lib/studio/use-director";
import { SystemContext } from "@/components/studio/system-context";
import { USAGE_CAPS } from "@/lib/studio/types";

export function Inspector() {
  const picture = useActivePicture();
  const selectedShotId = useStudio((s) => s.selectedShotId);
  const { busy, animate, ask } = useDirector();
  const openStillBay = useStudio((s) => s.openStillBay);
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState("");
  if (!picture) return null;
  const shot = picture.shots.find((s) => s.id === selectedShotId) ?? picture.shots[0];

  return (
    <aside className="flex h-full min-h-0 flex-col bg-surface">
      <div className="px-3 py-3">
        <p className="text-[11px] tracking-wide text-subtle uppercase">Inspector</p>
        <h2 className="mt-1 font-display text-xl tracking-tight">{picture.title}</h2>
        <p className="mt-1 text-xs text-muted">
          {engineById(picture.selectedEngine.director)?.name} · {engineById(picture.selectedEngine.image)?.name} ·{" "}
          {engineById(picture.selectedEngine.video)?.name}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {shot ? (
          <div className="rounded-md bg-elevated p-3 shadow-[var(--shadow-border)]">
            <p className="text-[11px] text-subtle">
              SHOT {String(shot.index).padStart(2, "0")} · {shot.type} · {shot.durationSec}s
            </p>
            <p className="mt-2 text-sm leading-relaxed">{shot.description}</p>
            <p className="mt-2 text-xs text-muted">
              {shot.camera} · {shot.lens}
            </p>
            <p className="mt-1 text-xs text-muted">Move: {shot.cameraMove}</p>
            <p className="mt-2 text-xs">
              <span className="text-subtle">Face · </span>
              {shot.expression}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" disabled={busy?.startsWith("still")} onClick={() => openStillBay(shot.id)}>
                {busy === `still:${shot.id}` ? "Exposing…" : "Generate still"}
              </Button>
              <Button size="sm" variant="secondary" disabled={busy?.startsWith("clip")} onClick={() => animate(shot.id)}>
                {busy === `clip:${shot.id}` ? "Rolling…" : "Animate 10–15s"}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">Compose a picture to inspect shots.</p>
        )}

        <Usage picture={picture} />
        <SystemContext />

        <form
          className="mt-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const text = await ask(q);
            if (text) {
              setAnswer(text);
              setQ("");
            }
          }}
        >
          <p className="text-[11px] tracking-wide text-subtle uppercase">Director</p>
          <Textarea
            className="mt-2 min-h-20"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Coverage, emotion, continuity…"
          />
          <Button className="mt-2 w-full" size="sm" variant="secondary" disabled={busy === "ask"} type="submit">
            {busy === "ask" ? "Thinking…" : "Ask"}
          </Button>
          {answer ? <p className="mt-3 text-sm leading-relaxed text-muted">{answer}</p> : null}
        </form>
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
      <p className="text-[11px] tracking-wide text-subtle uppercase">Caps</p>
      <ul className="mt-2 grid gap-1">
        {rows.map(([k, n, cap]) => (
          <li key={k} className="flex justify-between text-xs">
            <span>{k}</span>
            <span className="text-subtle tabular-nums">
              {n}/{cap}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
