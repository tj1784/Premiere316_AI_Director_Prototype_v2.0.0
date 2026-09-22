import { useState } from "react";
import { Film } from "lucide-react";

export function PictureCover({ picture }: { picture: { id: string; title: string; thumbnailUrl: string | null } }) {
  const [failedThumbnail, setFailedThumbnail] = useState<string | null>(null);

  if (picture.thumbnailUrl && picture.thumbnailUrl !== failedThumbnail) {
    return (
      <img
        src={picture.thumbnailUrl}
        alt=""
        className="size-full object-cover"
        loading="lazy"
        decoding="async"
        onError={() => setFailedThumbnail(picture.thumbnailUrl)}
      />
    );
  }

  return (
    <span className="picture-cover-empty" data-picture-cover={picture.id} aria-hidden="true">
      <Film className="picture-cover-empty-icon" strokeWidth={1} />
      <span>No cover</span>
    </span>
  );
}
