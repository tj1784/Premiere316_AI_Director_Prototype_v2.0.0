import { Input, Label, Textarea } from "@/components/ui/field";
import type { ResearchContent, ResearchSocialWorldNote } from "@/lib/research/bible.ts";

export function SocialWorldPanel({ content, onChange }: { content: ResearchContent; onChange: (content: ResearchContent) => void }) {
  const update = (index: number, patch: Partial<ResearchSocialWorldNote>) => {
    const socialWorldNotes = content.socialWorldNotes.map((note, current) => current === index ? { ...note, ...patch } : note);
    onChange({ ...content, socialWorldNotes });
  };
  return (
    <div className="grid gap-4">
      <p className="text-xs leading-relaxed text-muted">Social-world notes describe shown behavior, not camera grammar. Biblical / historical pictures seed from intake.</p>
      {content.socialWorldNotes.length === 0 ? <p className="text-xs text-muted">No social-world entries yet. Add them for biblical or historical pictures.</p> : null}
      {content.socialWorldNotes.map((note, index) => (
        <article key={note.id} className="grid gap-2 rounded-md bg-elevated p-3 shadow-[var(--shadow-border)]">
          <Label>Expected behavior</Label>
          <Input value={note.expectedBehavior} onChange={(event) => update(index, { expectedBehavior: event.target.value })} />
          <Label>Visible reaction</Label>
          <Input value={note.visibleReaction} onChange={(event) => update(index, { visibleReaction: event.target.value })} />
          <Label>Cinematic expression · blocking</Label>
          <Input value={note.cinematicExpression.blocking} onChange={(event) => update(index, { cinematicExpression: { ...note.cinematicExpression, blocking: event.target.value } })} />
          <Label>Costume / status sign</Label>
          <Input value={note.cinematicExpression.costumeOrStatusSign} onChange={(event) => update(index, { cinematicExpression: { ...note.cinematicExpression, costumeOrStatusSign: event.target.value } })} />
          <Label>Silence / withholding</Label>
          <Input value={note.cinematicExpression.silenceOrWithholding} onChange={(event) => update(index, { cinematicExpression: { ...note.cinematicExpression, silenceOrWithholding: event.target.value } })} />
          <Label>Gaze / spatial honor</Label>
          <Input value={note.cinematicExpression.gazeOrSpatialHonor} onChange={(event) => update(index, { cinematicExpression: { ...note.cinematicExpression, gazeOrSpatialHonor: event.target.value } })} />
          <Label>Prohibited exposition</Label>
          <Textarea className="min-h-16" value={note.cinematicExpression.prohibitedExposition} onChange={(event) => update(index, { cinematicExpression: { ...note.cinematicExpression, prohibitedExposition: event.target.value } })} />
        </article>
      ))}
    </div>
  );
}
