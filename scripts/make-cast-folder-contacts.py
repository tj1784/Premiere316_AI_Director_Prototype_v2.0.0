from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path("projects/harrowing_of_hell_v2/media/assets/imported/20260823T205250Z-cast-map-assets")
OUT = Path("projects/harrowing_of_hell_v2/production/_cast_contacts")
FOLDERS = [
    "crucifixion",
    "demons",
    "fallen-angels-the-abyss",
    "hell",
    "hellfire",
    "random",
    "torturer-and-the-tortured",
]
COLS = 4
ROWS = 4
THUMB_W = 480
THUMB_H = 206
LABEL_H = 28
PAD = 8

def files_for(folder: Path):
    items = []
    for path in sorted(folder.iterdir()):
        if path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".mp4"}:
            items.append(path)
    return items

def load_thumb(path: Path):
    if path.suffix.lower() == ".mp4":
        img = Image.new("RGB", (THUMB_W, THUMB_H), (24, 10, 10))
        draw = ImageDraw.Draw(img)
        draw.text((16, THUMB_H // 2 - 10), f"VIDEO {path.name[:40]}", fill=(220, 180, 180))
        return img
    with Image.open(path) as src:
        src = src.convert("RGB")
        src.thumbnail((THUMB_W, THUMB_H), Image.Resampling.LANCZOS)
        canvas = Image.new("RGB", (THUMB_W, THUMB_H), (8, 8, 8))
        x = (THUMB_W - src.width) // 2
        y = (THUMB_H - src.height) // 2
        canvas.paste(src, (x, y))
        return canvas

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    font = ImageFont.load_default()
    written = []
    for folder_name in FOLDERS:
        folder = ROOT / folder_name
        files = files_for(folder)
        per_sheet = COLS * ROWS
        sheets = (len(files) + per_sheet - 1) // per_sheet
        for sheet_i in range(sheets):
            chunk = files[sheet_i * per_sheet:(sheet_i + 1) * per_sheet]
            width = PAD + COLS * (THUMB_W + PAD)
            height = PAD + ROWS * (THUMB_H + LABEL_H + PAD)
            sheet = Image.new("RGB", (width, height), (12, 12, 12))
            draw = ImageDraw.Draw(sheet)
            for idx, path in enumerate(chunk):
                col = idx % COLS
                row = idx // COLS
                x = PAD + col * (THUMB_W + PAD)
                y = PAD + row * (THUMB_H + LABEL_H + PAD)
                sheet.paste(load_thumb(path), (x, y))
                number = path.name.split("-", 1)[0]
                label = f"{number} {path.suffix.lower()} {path.name[4:20]}"
                draw.rectangle((x, y + THUMB_H, x + THUMB_W, y + THUMB_H + LABEL_H), fill=(20, 20, 20))
                draw.text((x + 6, y + THUMB_H + 8), f"{folder_name[:18]} {number}", fill=(235, 230, 210), font=font)
            dest = OUT / f"{folder_name}-{sheet_i + 1:02d}-of-{sheets:02d}.jpg"
            sheet.save(dest, quality=85)
            written.append(str(dest))
            print(dest, len(chunk))
    print("sheets", len(written))

if __name__ == "__main__":
    main()
