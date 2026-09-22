import { Clapperboard } from "lucide-react";
import { makePictureIntake } from "@/lib/studio/picture-intake";
import { useStudio } from "@/lib/studio/store";
import { InterfaceScale } from "./interface-scale";
import { PicturesLibrary } from "./pictures-library";

export function HomeBay() {
  const pictures = useStudio((state) => state.pictures);
  const openPicture = useStudio((state) => state.openPicture);
  const newPicture = useStudio((state) => state.newPicture);

  return (
    <div className="home-atrium">
      <header className="home-masthead">
        <div className="home-wordmark">
          <Clapperboard className="size-5" aria-hidden="true" />
          <span>Premiere316</span>
        </div>
        <InterfaceScale />
      </header>

      <main className="home-main">
        <PicturesLibrary
          pictures={pictures}
          onNew={() => newPicture(makePictureIntake())}
          onOpen={openPicture}
        />
      </main>
    </div>
  );
}
