"""Paint out the thin ground line a turnaround sheet draws under its views, before cutting it.

    python3 scripts/no_ground_line.py SHEET OUT
"""
import sys
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGB'); W, H = im.size; px = im.load()
def fg(x, y):
    if y < 0 or y >= H: return False
    b = px[2, y]; p = px[x, y]; return abs(p[0]-b[0])+abs(p[1]-b[1])+abs(p[2]-b[2]) > 40
o = im.copy(); q = o.load(); gone = 0
for y in range(H):
    run = []
    for x in range(W + 1):
        thin = x < W and fg(x, y) and not fg(x, y-4) and not fg(x, y+4)
        if thin: run.append(x)
        else:
            if len(run) > 60:
                for rx in run:
                    for dy in (-2, -1, 0, 1, 2):
                        if 0 <= y+dy < H and fg(rx, y+dy): q[rx, y+dy] = px[2, y]
                gone += len(run)
            run = []
o.save(out); print('painted out', gone)
