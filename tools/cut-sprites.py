"""Cuts the supplied sprite sheets into the small atlases the game loads.

Players: one team's row is cut into frames, shrunk to game size and split into a colour layer and a
material mask, so the game can repaint jersey, helmet and pants in any school's colours.
Stadium: sponsor boards and bleachers are cropped and packed into one strip.

Run from the repository root:  python3 tools/cut-sprites.py
"""
import colorsys, json
from PIL import Image
import numpy as np

SRC = 'art/source/sheets2/'
OUT = 'apps/client/src/assets/'
SCALE = 0.4            # sheet pixels to game pixels (the scene draws at 960 x 540)
CELL_W, CELL_H = 40, 36

# Frames of the red-and-silver row, by x range in the sheet. Names are what the game asks for.
ROW = (212, 297)
FRAMES = [
    ('run0', 77, 121), ('run1', 279, 329), ('run2', 347, 393), ('run3', 416, 451),
    ('arm0', 139, 204), ('arm1', 212, 277),
    ('throw0', 473, 537), ('throw1', 567, 618), ('catch', 641, 675), ('ready', 698, 737),
    ('down', 833, 907), ('cheer', 922, 969),
    ('stance0', 985 + 63, 1095), ('stance1', 1114, 1162), ('kick0', 1254, 1301), ('kick1', 1318, 1364),
]

def classify(px, upper):
    """Returns (material, shade): 0 keep the sheet's colour, 1 jersey, 2 helmet, 3 pants."""
    r, g, b, a = [int(v) for v in px]
    if a < 128: return 0, 0
    h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    hue = h * 360
    if v < 0.22: return 0, 0                                   # outline
    if (hue < 14 or hue > 340) and s > 0.5: return 1, v        # red: jersey and the helmet stripe
    if s < 0.2 and v > 0.3: return (2 if upper else 3), v      # silver: helmet above the jersey, pants below
    return 0, 0                                                 # skin, ball, shoes

def cut_players():
    sheet = Image.open(SRC + '01_tecmo_players_spritesheet.png').convert('RGBA')
    base = Image.new('RGBA', (CELL_W * len(FRAMES), CELL_H), (0, 0, 0, 0))
    mask = Image.new('RGBA', (CELL_W * len(FRAMES), CELL_H), (0, 0, 0, 0))
    for i, (name, x0, x1) in enumerate(FRAMES):
        fr = sheet.crop((x0, ROW[0], x1, ROW[1]))
        box = fr.getbbox()
        fr = fr.crop(box)
        w, h = max(1, round(fr.width * SCALE)), max(1, round(fr.height * SCALE))
        small = fr.resize((w, h), Image.LANCZOS)
        a = np.array(small)
        a[:, :, 3] = np.where(a[:, :, 3] > 110, 255, 0)
        # Where the jersey is: silver above its middle is helmet, below is pants. Lying down, the head is to the right.
        red = [(x, y) for y in range(h) for x in range(w) if classify(a[y, x], True)[0] == 1]
        cy = sum(p[1] for p in red) / max(1, len(red))
        cx = sum(p[0] for p in red) / max(1, len(red))
        m = np.zeros((h, w, 4), dtype=np.uint8)
        for y in range(h):
            for x in range(w):
                upper = (x > cx) if name == 'down' else (y < cy)
                mat, v = classify(a[y, x], upper)
                if mat:
                    m[y, x] = (mat * 60, min(255, int(v * 255)), 0, 255)
        ox = i * CELL_W + (CELL_W - w) // 2
        oy = CELL_H - h
        base.paste(Image.fromarray(a), (ox, oy))
        mask.paste(Image.fromarray(m), (ox, oy))
    base.save(OUT + 'players-base.png', optimize=True)
    mask.save(OUT + 'players-mask.png', optimize=True)
    return [f[0] for f in FRAMES]

def boxes(im, y0, y1, min_w, min_h, bg=(58, 58, 58), tol=26):
    """Rectangles that stand out from the sheet's flat grey background between two rows."""
    a = np.array(im.convert('RGB')).astype(int)
    diff = (np.abs(a - np.array(bg)).sum(axis=2) > tol)
    diff[:y0] = False
    diff[y1:] = False
    out = []
    rows = diff.sum(axis=1)
    y = y0
    while y < y1:
        if rows[y] > min_w * 0.5:
            ys = y
            while y < y1 and rows[y] > min_w * 0.5: y += 1
            cols = diff[ys:y].sum(axis=0)
            x = 0
            W = diff.shape[1]
            while x < W:
                if cols[x] > (y - ys) * 0.5:
                    xs = x
                    while x < W and cols[x] > (y - ys) * 0.35: x += 1
                    if x - xs >= min_w and y - ys >= min_h: out.append((xs, ys, x, y))
                x += 1
        y += 1
    return out

def cut_stadium():
    ads = Image.open(SRC + '09_sponsor_banners.jpg').convert('RGB')
    found = boxes(ads, 940, 1430, 300, 100)
    found += boxes(ads, 440, 880, 300, 90)
    # One of each sponsor, not three: keep boards that do not look like one already kept.
    kept = []
    sig = lambda b: np.array(ads.crop(b).resize((12, 4), Image.BILINEAR)).astype(int)
    for b in found:
        if all(np.abs(sig(b) - sig(k)).mean() > 26 for k in kept): kept.append(b)
    H = 28
    pieces = [ads.crop(b).resize((round((b[2] - b[0]) * H / (b[3] - b[1])), H), Image.LANCZOS) for b in kept]
    crowd = Image.open(SRC + '05_high_school_crowd_spritesheet.png').convert('RGBA')
    stands = []
    for (x0, y0, x1, y1) in [(306, 0, 715, 200), (690, 40, 1010, 200), (1040, 20, 1365, 200), (8, 55, 350, 200)]:
        s = crowd.crop((x0, y0, x1, y1))
        s = s.crop(s.getbbox())
        stands.append(s.resize((round(s.width * 0.42), round(s.height * 0.42)), Image.LANCZOS))
    SH = max(s.height for s in stands)
    width = sum(p.width + 2 for p in pieces) + sum(s.width + 2 for s in stands)
    strip = Image.new('RGBA', (width, max(H, SH)), (0, 0, 0, 0))
    meta = {'ads': [], 'stands': []}
    x = 0
    for p in pieces:
        strip.paste(p, (x, 0)); meta['ads'].append([x, 0, p.width, p.height]); x += p.width + 2
    for s in stands:
        strip.paste(s, (x, 0)); meta['stands'].append([x, 0, s.width, s.height]); x += s.width + 2
    strip.save(OUT + 'stadium.png', optimize=True)
    return meta

if __name__ == '__main__':
    names = cut_players()
    meta = cut_stadium()
    with open('apps/client/src/art-atlas.ts', 'w') as f:
        f.write('// Written by tools/cut-sprites.py. Do not edit by hand.\n')
        f.write(f'export const PLAYER_CELL = {{ w: {CELL_W}, h: {CELL_H} }};\n')
        f.write(f'export const PLAYER_FRAMES = {json.dumps(names)} as const;\n')
        f.write(f'export const STADIUM = {json.dumps(meta)};\n')
    print(len(names), 'player frames;', len(meta['ads']), 'sponsor boards;', len(meta['stands']), 'stands')
