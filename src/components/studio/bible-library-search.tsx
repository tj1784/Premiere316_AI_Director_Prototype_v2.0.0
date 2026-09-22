import { useMemo, useState } from "react";
import { Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { searchMovieBibles } from "@/lib/studio/movie-bible";
import { useStudio } from "@/lib/studio/store";

export function BibleLibrarySearch() {
  const pictures = useStudio((s) => s.pictures);
  const voices = useStudio((s) => s.voiceDesignAssets);
  const [query, setQuery] = useState("");
  const rows = useMemo(() => searchMovieBibles(pictures, query), [pictures, query]);
  const sharedVoices = query.trim()
    ? voices
        .filter(
          (v) =>
            !v.deletedAt &&
            `${v.id} ${v.design.name} ${v.status}`
              .toLowerCase()
              .includes(query.trim().toLowerCase()),
        )
        .slice(0, 20)
    : [];
  return (
    <details className="rounded-lg border border-border bg-surface p-4">
      <summary className="cursor-pointer">Search across pictures & shared voices</summary>
      <p className="my-2 text-sm text-muted">
        Discovery opens the canonical owner. Nothing is copied, substituted or approved.
      </p>
      <Input
        aria-label="Search across picture Bibles"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="ID, alias, character, scene, type or status…"
      />
      <div className="mt-3 max-h-80 overflow-auto">
        {rows.map((row) => (
          <Button
            key={`${row.ownerId}:${row.kind}:${row.id}`}
            variant="ghost"
            className="my-1 h-auto w-full justify-start whitespace-normal break-words text-left"
            onClick={() => {
              const state = useStudio.getState();
              const owner = state.pictures.find((p) => p.id === row.ownerId);
              if (!owner) return;
              state.replaceActive({
                ...owner,
                workspacePanel: "bible",
                editorDrafts: {
                  ...owner.editorDrafts,
                  "bible-record:Movie Script Bible": row.id,
                  "bible-edit-field:Movie Script Bible": null,
                },
              });
              state.openPicture(owner.id);
            }}
          >
            {row.pictureTitle} · {row.name} · {row.kind} · {row.status}
          </Button>
        ))}
        {sharedVoices.map((voice) => (
          <Button
            key={`shared:${voice.id}`}
            variant="ghost"
            className="my-1 h-auto w-full justify-start whitespace-normal break-words text-left"
            onClick={() => {
              useStudio.getState().patchActive({ workspacePanel: null });
              useStudio.getState().openAdvancedDepartment("score");
            }}
          >
            Shared voice · {voice.design.name} · {voice.status} · {voice.id}
          </Button>
        ))}
        {query.trim() && !rows.length && !sharedVoices.length && (
          <p className="text-sm text-muted">No matching loaded records.</p>
        )}
      </div>
    </details>
  );
}
