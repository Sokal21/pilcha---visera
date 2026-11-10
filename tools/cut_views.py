"""Cut a turnaround sheet into its four views where tools/cut_turnaround.py cannot: a sheet in a two by
two grid (`grid`), or a row whose figures touch or whose grey darkens downward (`row`, cut at the
emptiest columns). Each pixel is compared with the background at its own row.

    python3 scripts/cut_views.py SHEET OUT_PREFIX grid|row frente derecha espalda tres_cuartos
"""
import sys
from PIL import Image
src, prefix, mode = sys.argv[1], sys.argv[2], sys.argv[3]
names = sys.argv[4:]
im = Image.open(src).convert('RGB'); W, H = im.size; px = im.load()
def fg(x, y):
    b = px[2, y]; p = px[x, y]; return abs(p[0]-b[0])+abs(p[1]-b[1])+abs(p[2]-b[2]) > 40
if mode == 'grid':
    boxes = [(0, 0, W//2, H//2), (W//2, 0, W, H//2), (0, H//2, W, H), (W//2, H//2, W, H)]
    boxes[2] = (0, H//2, W//2, H)
else:
    col = [sum(fg(x, y) for y in range(0, H, 2)) for x in range(W)]
    cuts = [min(range(int(W*(c-.08)), int(W*(c+.08))), key=lambda i: col[i]) for c in (.25, .5, .75)]
    e = [0]+cuts+[W]; boxes = [(e[i], 0, e[i+1], H) for i in range(4)]
for name, (x0, y0, x1, y1) in zip(names, boxes):
    pts = [(x, y) for x in range(x0, x1, 2) for y in range(y0, y1, 2) if fg(x, y)]
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    box = (max(x0, min(xs)-2), max(y0, min(ys)-2), min(x1, max(xs)+3), min(y1, max(ys)+3))
    crop = im.crop(box); s = int(max(crop.size)*1.1)
    sq = Image.new('RGB', (s, s), px[2, 2]); sq.paste(crop, ((s-crop.width)//2, (s-crop.height)//2))
    sq.save(f'{prefix}_{name}.png'); print(name, box)
