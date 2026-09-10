from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
folder = Path(__file__).resolve().parent / 'Pictures' / 'Unassigned' / 'Recovered Upload Candidates'
files = sorted([p for p in folder.iterdir() if p.suffix.lower() in {'.png','.jpg','.jpeg'}])[:60]
thumb_w, thumb_h = 220, 150
cols = 5
rows = (len(files)+cols-1)//cols
sheet = Image.new('RGB', (cols*thumb_w, rows*(thumb_h+32)), 'white')
d = ImageDraw.Draw(sheet)
for i,p in enumerate(files):
    r,c = divmod(i, cols)
    x,y = c*thumb_w, r*(thumb_h+32)
    try:
        im = Image.open(p).convert('RGB')
        im.thumbnail((thumb_w, thumb_h), Image.LANCZOS)
        ox = x + (thumb_w-im.width)//2
        oy = y + (thumb_h-im.height)//2
        sheet.paste(im, (ox, oy))
    except Exception as e:
        d.text((x+4,y+50), 'OPEN FAIL', fill=(180,0,0))
    d.rectangle((x,y,x+thumb_w-1,y+thumb_h-1), outline=(0,0,0))
    d.text((x+4,y+thumb_h+4), f'{i+1:02d} {p.name[:24]}', fill=(0,0,0))
out = folder / 'contact-sheet.jpg'
sheet.save(out, quality=88)
print(out)
