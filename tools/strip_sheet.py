"""Lay rendered frames side by side, one row per directory given: python3 scripts/strip_sheet.py OUT.png DIR..."""
import glob
import os
import sys

from PIL import Image

out, dirs = sys.argv[1], sys.argv[2:]
rows = [[Image.open(f).convert('RGBA') for f in sorted(glob.glob(os.path.join(d, 'f_*.png')), key=lambda p: int(p.rsplit('_', 1)[1][:-4]))] for d in dirs]
# Cropped to what all of them cover, so the figure fills its frame.
boxes = [im.getbbox() for row in rows for im in row if im.getbbox()]
box = (min(b[0] for b in boxes) - 4, min(b[1] for b in boxes) - 4, max(b[2] for b in boxes) + 4, max(b[3] for b in boxes) + 4)
rows = [[im.crop(box) for im in row] for row in rows]
w, h = rows[0][0].size
sheet = Image.new('RGBA', (w * max(len(r) for r in rows), h * len(rows)), (60, 56, 52, 255))
for j, row in enumerate(rows):
    for i, im in enumerate(row):
        sheet.alpha_composite(im, (i * w, j * h))
sheet.convert('RGB').save(out)
print('WROTE', out, sheet.size)
