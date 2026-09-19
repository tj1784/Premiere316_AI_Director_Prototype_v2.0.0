import { useState } from "react";

type Cover = { title: string; subtitle: string; images: string[]; layout?: "board" | "triptych"; edition?: string };
const art = (name: string) => `/picture-covers/${name}`;
const harrowing = [art("harrowing-jesus.png"), art("harrowing-gates.png"), art("harrowing-adam.png")];

// Covers are presentation assets: they do not change casting or approval decisions.
const covers: Record<string, Cover> = {
  pic_last_reel: { title: "The Last Reel", subtitle: "A quiet supernatural drama", images: [art("last-reel.png")] },
  folder_david_the_valley_of_elah: { title: "David", subtitle: "The Valley of Elah", images: [art("david.png")] },
  folder_best_next_test_david_the_valley_of_elah: { title: "David", subtitle: "The Valley of Elah · development study", images: [art("david.png")], edition: "Study" },
  folder_harrowing_of_hell: { title: "Harrowing of Hell", subtitle: "Visual development", images: harrowing, layout: "triptych" },
  folder_harrowing_of_hell_v2: { title: "Harrowing of Hell", subtitle: "The second vision", images: [art("harrowing-v2-jesus.png"), art("harrowing-v2-golgotha.png"), art("harrowing-gates.png")], layout: "triptych", edition: "II" },
  folder_harrowing_shorts_lane: { title: "Harrowing Shorts", subtitle: "Short film collection", images: [harrowing[1], harrowing[0], harrowing[2]], layout: "triptych", edition: "Shorts" },
  folder_harrowing_shorts_prototype: { title: "Harrowing Shorts", subtitle: "A visual study", images: [harrowing[2], harrowing[1], harrowing[0]], layout: "triptych", edition: "Study" },
  folder_moses_splitting_of_the_sea_and_crossing: { title: "Moses", subtitle: "Splitting of the Sea and Crossing", images: [art("moses-reference.jpg")], layout: "board" },
  folder_prototype: { title: "Prototype", subtitle: "Picture development", images: [art("studio-studies.png")], edition: "P / 01" },
  folder_test: { title: "Test", subtitle: "Picture development", images: [art("studio-studies.png")], edition: "T / 01" },
  folder_test_2: { title: "Test", subtitle: "Picture development", images: [art("studio-studies.png")], edition: "T / 02" },
  folder_test_3: { title: "Test", subtitle: "Picture development", images: [art("studio-studies.png")], edition: "T / 03" },
};

export function PictureCover({ picture }: { picture: { id: string; title: string; thumbnailUrl: string | null } }) {
  const [failedThumbnail, setFailedThumbnail] = useState<string | null>(null);
  if (picture.thumbnailUrl && picture.thumbnailUrl !== failedThumbnail) {
    return <img src={picture.thumbnailUrl} alt="" className="size-full object-cover" onError={() => setFailedThumbnail(picture.thumbnailUrl)} />;
  }
  const cover = covers[picture.id] ?? { title: picture.title, subtitle: "Picture development", images: [art("studio-studies.png")] };
  return (
    <span className="picture-cover" data-picture-cover={picture.id} aria-hidden="true">
      <span className="picture-cover-heading">
        <span className="picture-cover-title">{cover.title}</span>
        <span className="picture-cover-subtitle">{cover.subtitle}</span>
      </span>
      <span className={`picture-cover-art picture-cover-art--${cover.layout ?? "single"}`}>
        {cover.images.map((src, index) => <img key={`${src}-${index}`} src={src} alt="" loading="lazy" decoding="async" />)}
      </span>
      {cover.edition ? <span className="picture-cover-edition">{cover.edition}</span> : null}
    </span>
  );
}
