import { useRef, useState } from "react";
import { Clapperboard } from "lucide-react";
import { toast } from "sonner";
import { makePictureIntake, sourceMediaType } from "@/lib/studio/picture-intake";
import { useStudio } from "@/lib/studio/store";
import { InterfaceScale } from "./interface-scale";
import { PicturesLibrary } from "./pictures-library";
import "./home-workbench.css";

export function HomeBay() {
  const pictures = useStudio((state) => state.pictures);
  const openPicture = useStudio((state) => state.openPicture);
  const newPicture = useStudio((state) => state.newPicture);
  const sourceFile = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  async function importSource(file: File) {
    const mediaType = sourceMediaType(file.name);
    if (!mediaType) {
      toast.error("Choose a Fountain, Markdown or plain text source.");
      return;
    }
    setImporting(true);
    try {
      const text = await file.text();
      if (!text.trim()) throw new Error("This source file is empty.");
      const intake = makePictureIntake();
      intake.title = file.name.replace(/\.(fountain|markdown|md|txt)$/i, "").replaceAll("_", " ");
      intake.sourceType = mediaType === "text/fountain" ? "existing-screenplay" : "source-material";
      intake.existingScreenplay = intake.sourceType === "existing-screenplay" ? text : "";
      intake.sourceMaterial = intake.sourceType === "source-material" ? text : "";
      intake.importedSources = [{ fileName: file.name, mediaType, importedAt: Date.now(), text }];
      newPicture(intake);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The source could not be imported.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="home-atrium home-workbench">
      <header className="home-masthead">
        <div className="home-wordmark">
          <Clapperboard className="size-5" aria-hidden="true" />
          <span>Premiere316</span>
        </div>
        <InterfaceScale />
      </header>

      <main className="home-main">
        <input ref={sourceFile} className="sr-only" type="file" aria-label="Import movie source" accept=".fountain,.txt,.md,.markdown,text/plain,text/markdown" onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void importSource(file);
        }} />
        <PicturesLibrary
          pictures={pictures}
          onNew={() => newPicture(makePictureIntake())}
          onOpen={openPicture}
          onImport={() => sourceFile.current?.click()}
          importing={importing}
        />
      </main>
    </div>
  );
}
