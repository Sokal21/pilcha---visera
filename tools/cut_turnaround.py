"""Cut a turnaround sheet into one square picture per view, for image-to-3D.

    python3 scripts/cut_turnaround.py SHEET OUT_PREFIX NAME...

The sheet shows one figure per view, side by side on a plain background (taken from its top-left
corner). Each view is cut by its connected parts, not by straight lines: a hand of one figure and
the sabre of the next can share columns. Every part goes to the figure whose middle it is nearest,
so a sabre that came loose from its owner still goes with him. Each view is saved as
OUT_PREFIX_NAME.png, centred on a square of the same background.

    python3 scripts/cut_turnaround.py SHEET.png out/vista \
        frente derecha espalda tres_cuartos
"""
import sys
from collections import deque

from PIL import Image

K = 4          # the sheet is looked at this many times smaller, to find its parts
APART = 30     # how far from the background a colour has to be to be part of a figure
LEAST = 500    # parts smaller than this, at the reduced size, do not mark where a figure is
MARGIN = 80    # background left round each figure in its square


def main(sheet: str, prefix: str, names: list[str]) -> None:
    im = Image.open(sheet).convert('RGBA')
    W, H = im.size
    bg = im.getpixel((5, 5))[:3]
    w, h = W // K, H // K
    px = im.convert('RGB').resize((w, h), Image.NEAREST).load()
    fg = [[sum(abs(px[x, y][i] - bg[i]) for i in range(3)) > APART for x in range(w)] for y in range(h)]

    # Connected parts, each with its size and the middle of its columns.
    lab = [[0] * w for _ in range(h)]
    parts: dict[int, tuple[int, float]] = {}
    for y in range(h):
        for x in range(w):
            if not fg[y][x] or lab[y][x]:
                continue
            n = len(parts) + 1
            lab[y][x] = n
            ahead, xs = deque([(x, y)]), []
            while ahead:
                cx, cy = ahead.popleft()
                xs.append(cx)
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < w and 0 <= ny < h and fg[ny][nx] and not lab[ny][nx]:
                        lab[ny][nx] = n
                        ahead.append((nx, ny))
            parts[n] = (len(xs), sum(xs) / len(xs))

    # Where each figure stands: the big parts, gathered into as many groups as there are names.
    big = sorted(cx for size, cx in parts.values() if size >= LEAST)
    gaps = sorted(range(1, len(big)), key=lambda i: big[i] - big[i - 1])[-(len(names) - 1):]
    bounds = [0, *sorted(gaps), len(big)]
    middles = [sum(big[a:b]) / (b - a) for a, b in zip(bounds, bounds[1:])]
    owner = {n: min(range(len(names)), key=lambda i: abs(cx - middles[i])) for n, (_, cx) in parts.items()}

    for i, name in enumerate(names):
        mask = Image.new('L', (w, h), 0)
        mp, xs, ys = mask.load(), [], []
        for y in range(h):
            for x in range(w):
                if lab[y][x] and owner[lab[y][x]] == i:
                    mp[x, y] = 255
                    xs.append(x)
                    ys.append(y)
        mask = mask.resize((W, H), Image.NEAREST)
        cut = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        cut.paste(im, (0, 0), mask)
        cut = cut.crop(((min(xs) - 2) * K, (min(ys) - 2) * K, (max(xs) + 3) * K, (max(ys) + 3) * K))
        side = max(cut.size) + MARGIN
        square = Image.new('RGB', (side, side), bg)
        square.paste(cut, ((side - cut.size[0]) // 2, (side - cut.size[1]) // 2), cut)
        square.save(f'{prefix}_{name}.png')
        print(f'{prefix}_{name}.png', cut.size)


if __name__ == '__main__':
    if len(sys.argv) < 5:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2], sys.argv[3:])
