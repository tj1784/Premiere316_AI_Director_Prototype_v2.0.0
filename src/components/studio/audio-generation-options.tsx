import { Check, ExternalLink, Mic2, Music2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AUDIO_GENERATION_GROUPS, AUDIO_GENERATION_OPTIONS, TTS_AUDIO_SUITE_URL, audioGenerationOption, type AudioGenerationOption } from "@/lib/studio/audio-generation-catalog";
import { useStudio } from "@/lib/studio/store";
import type { Picture } from "@/lib/studio/types";
import { cn } from "@/lib/utils";

export function AudioGenerationOptions({ picture }: { picture: Picture }) {
  const setEngines = useStudio((state) => state.setEngines);
  const selectedMusic = audioGenerationOption(picture.selectedEngine.music);
  const selectedVoice = audioGenerationOption(picture.selectedEngine.voice === "voxcpm" ? "voxcpm2" : picture.selectedEngine.voice);
  return (
    <section aria-label="Audio generation options" className="min-w-0 rounded-lg border border-border bg-surface p-4 text-fg sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-xl">Music, sound & voices</h3>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">Save the engines for this picture. Set up only the models you need.</p>
        </div>
        <span className="rounded-sm bg-inset px-2 py-1 text-xs text-muted">Local audio setup required</span>
      </div>
      <p role="status" className="mt-3 text-sm leading-relaxed text-muted">Selections are saved. Direct audio generation in Premiere316 is not connected yet; use the linked local workflows and import the finished audio.</p>
      <div aria-live="polite" className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <span className="inline-flex items-center gap-2"><Music2 className="size-4 text-muted" aria-hidden="true" /> Music / sound: {selectedMusic?.name ?? picture.selectedEngine.music}</span>
        <span className="inline-flex items-center gap-2"><Mic2 className="size-4 text-muted" aria-hidden="true" /> Voice: {selectedVoice?.name ?? picture.selectedEngine.voice}</span>
      </div>
      <div className="mt-5 space-y-6">
        {AUDIO_GENERATION_GROUPS.map((group) => (
          <div key={group.id}>
            <h4 className="text-sm font-medium">{group.title}</h4>
            <p className="mt-1 text-xs leading-relaxed text-muted">{group.description}</p>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              {AUDIO_GENERATION_OPTIONS.filter((option) => option.group === group.id).map((option) => {
                const selected = option.slot === "voice" ? selectedVoice?.id === option.id : selectedMusic?.id === option.id;
                return <AudioOption key={option.id} option={option} selected={selected} onSelect={() => setEngines({ [option.slot]: option.id })} />;
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-5 text-xs leading-relaxed text-muted">One shared voice pack: <a className="inline-flex min-h-11 items-center gap-1 text-fg underline underline-offset-4" href={TTS_AUDIO_SUITE_URL} target="_blank" rel="noreferrer">TTS-Audio-Suite <ExternalLink className="size-3" aria-hidden="true" /></a> for Qwen3-TTS and IndexTTS. VoxCPM2 uses its linked official runtime.</p>
    </section>
  );
}

function AudioOption({ option, selected, onSelect }: { option: AudioGenerationOption; selected: boolean; onSelect: () => void }) {
  return (
    <article className={cn("flex min-w-0 flex-col rounded-md border bg-inset p-4 text-fg", selected ? "border-accent" : "border-border")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h5 className="text-sm font-medium">{option.name}</h5>
          <p className="mt-1 text-xs leading-relaxed text-muted">{option.purpose}</p>
        </div>
        <Button size="md" variant={selected ? "primary" : "secondary"} onClick={onSelect} aria-pressed={selected} aria-label={`Select ${option.name}`}>
          {selected && <Check aria-hidden="true" />} {selected ? "Selected" : "Select"}
        </Button>
      </div>
      <p className="mt-3 text-xs font-medium text-fg">{option.license.label}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted">{option.license.detail}</p>
      <details className="mt-3 border-t border-border pt-1 text-xs">
        <summary className="min-h-11 cursor-pointer py-3 font-medium text-fg">Template & setup</summary>
        <p className="font-medium text-fg">{option.template}</p>
        <ul className="mt-2 list-disc space-y-2 pl-4 leading-relaxed text-muted">{option.setupNotes.map((note) => <li key={note}>{note}</li>)}</ul>
        {option.files.length > 0 && <div className="mt-3 space-y-2 rounded-sm bg-surface p-3 text-fg">{option.files.map((file) => <code className="block break-all text-xs" key={file}>{file}</code>)}</div>}
        <div className="mt-2 flex flex-wrap gap-x-5 text-fg">
          <ResourceLink href={option.setupUrl}>Setup guide</ResourceLink>
          <ResourceLink href={option.modelUrl}>Model files</ResourceLink>
          <ResourceLink href={option.license.url}>License source</ResourceLink>
        </div>
      </details>
    </article>
  );
}

function ResourceLink({ href, children }: { href: string; children: string }) {
  return <a className="inline-flex min-h-11 items-center gap-1 underline underline-offset-4" href={href} target="_blank" rel="noreferrer">{children} <ExternalLink className="size-3" aria-hidden="true" /></a>;
}
