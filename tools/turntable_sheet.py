"""Lay out a turntable's eight views in a row, sharp above and pixelated below, beside a sprite.

    python3 scripts/turntable_sheet.py RENDER_DIR OUT.png [--tall 82] [--sprite SPRITE.png]

The pixelated row is each view shrunk so the figure is `--tall` pixels high, as the game draws
it, then blown up again in blocks: how it will read on screen. The sprite, if given, stands at
the same scale at the end of that row.
"""
import os
import sys

from PIL import Image

args = sys.argv[1:]
src, dst = args[0], args[1]
opts = dict(zip(args[2::2], args[3::2]))
TALL = int(opts.get('--tall', 82))
SPRITE = opts.get('--sprite')
SHOWN = 3       # each game pixel, blown up
BACK = (60, 56, 52, 255)

views = [Image.open(os.path.join(src, f'giro_{n}.png')).convert('RGBA') for n in range(8)]
boxes = [v.getbbox() for v in views]
top, bottom = min(b[1] for b in boxes), max(b[3] for b in boxes)
k = TALL / (bottom - top)
side = views[0].width
small = [v.resize((max(1, round(v.width * k)), max(1, round(v.height * k))), Image.LANCZOS) for v in views]
blocky = [s.resize((s.width * SHOWN, s.height * SHOWN), Image.NEAREST) for s in small]
bw = blocky[0].width
extra = 0
sprite = None
if SPRITE:
    sprite = Image.open(SPRITE).convert('RGBA')
    sprite = sprite.resize((sprite.width * SHOWN, sprite.height * SHOWN), Image.NEAREST)
    extra = sprite.width + 20
sheet = Image.new('RGBA', (max(side, bw) * 8 + extra, side + blocky[0].height), BACK)
for n in range(8):
    sheet.alpha_composite(views[n], (n * max(side, bw), 0))
    sheet.alpha_composite(blocky[n], (n * max(side, bw) + (max(side, bw) - bw) // 2, side))
if sprite:
    sheet.alpha_composite(sprite, (8 * max(side, bw) + 10, side + blocky[0].height - sprite.height))
sheet.convert('RGB').save(dst)
print('WROTE', dst, sheet.size)
