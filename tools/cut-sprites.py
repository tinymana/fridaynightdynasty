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
    # The stands, seen square on, from the front-view stadium sheet: tiles that butt together, and three props
    # whose flat grey background is flooded away from the edges.
    front = Image.open(SRC + '23_front_stadium.jpg').convert('RGB')
    TILE_H = 88
    def tile(box):
        t = front.crop(box)
        return t.resize((round(t.width * TILE_H / t.height), TILE_H), Image.LANCZOS).convert('RGBA')
    def prop(box):
        t = front.crop(box).convert('RGBA')
        a = np.array(t).astype(int)
        h, w = a.shape[:2]
        bg = np.array([58, 58, 58])
        near = np.abs(a[:, :, :3] - bg).sum(axis=2) < 40
        seen = np.zeros((h, w), dtype=bool)
        stack = [(x, y) for x in range(w) for y in (0, h - 1)] + [(x, y) for y in range(h) for x in (0, w - 1)]
        while stack:
            x, y = stack.pop()
            if x < 0 or y < 0 or x >= w or y >= h or seen[y, x] or not near[y, x]: continue
            seen[y, x] = True
            stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
        a[:, :, 3] = np.where(seen, 0, 255)
        t = Image.fromarray(a.astype(np.uint8))
        t = t.crop(t.getbbox())
        return t.resize((round(t.width * TILE_H / t.height), TILE_H), Image.LANCZOS)
    # empty, sparse, packed, packed, band; then press tower and scoreboard
    stands = [tile((47, 42, 647, 328)), tile((691, 42, 1265, 328)), tile((47, 372, 647, 662)), tile((691, 372, 1265, 662)), tile((47, 730, 640, 968)),
              prop((1345, 70, 1745, 665)), prop((2145, 228, 2535, 665))]
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

def repaintable(fr, lying=False):
    """Shrinks a frame to game size and returns (colour layer, material mask)."""
    fr = fr.crop(fr.getbbox())
    w, h = max(1, round(fr.width * SCALE)), max(1, round(fr.height * SCALE))
    a = np.array(fr.resize((w, h), Image.LANCZOS))
    a[:, :, 3] = np.where(a[:, :, 3] > 110, 255, 0)
    red = [(x, y) for y in range(h) for x in range(w) if classify(a[y, x], True)[0] == 1]
    cy = sum(q[1] for q in red) / max(1, len(red))
    cx = sum(q[0] for q in red) / max(1, len(red))
    m = np.zeros((h, w, 4), dtype=np.uint8)
    for y in range(h):
        for x in range(w):
            mat, v = classify(a[y, x], (x > cx) if lying else (y < cy))
            if mat: m[y, x] = (mat * 60, min(255, int(v * 255)), 0, 255)
    return Image.fromarray(a), Image.fromarray(m)

# The sideline, from the red-and-silver row of the sideline sheet: (name, x0, x1).
SIDE_ROW = (124, 213)
SIDE = [('stand0', 79, 125), ('stand1', 137, 183), ('stand2', 195, 249), ('stand3', 253, 302), ('bench', 381, 553),
        ('parka', 573, 625), ('coach0', 705, 765), ('coach1', 766, 825), ('cheer0', 1108, 1158), ('cheer1', 1159, 1207), ('cheer2', 1208, 1256)]
# The chain crew, in their own colours: (name, x0, y0, x1, y1).
CREW = [('stick', 492, 16, 549, 90), ('box1', 215, 16, 264, 90), ('box2', 215, 93, 264, 173), ('box3', 355, 16, 407, 90), ('box4', 419, 16, 475, 90)]

def cut_sideline():
    sheet = Image.open(SRC + '18_sideline_teams_spritesheet.png').convert('RGBA')
    crew = Image.open(SRC + '20_chain_gang_spritesheet.png').convert('RGBA')
    parts = [(n, *repaintable(sheet.crop((x0, SIDE_ROW[0], x1, SIDE_ROW[1])))) for n, x0, x1 in SIDE]
    for n, x0, y0, x1, y1 in CREW:
        fr = crew.crop((x0, y0, x1, y1))
        fr = fr.crop(fr.getbbox())
        small = fr.resize((max(1, round(fr.width * SCALE)), max(1, round(fr.height * SCALE))), Image.LANCZOS)
        parts.append((n, small, Image.new('RGBA', small.size, (0, 0, 0, 0))))
    H = max(b.height for _, b, _ in parts)
    W = sum(b.width + 1 for _, b, _ in parts)
    base = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    mask = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    meta = {}
    x = 0
    for n, b, m in parts:
        base.paste(b, (x, H - b.height)); mask.paste(m, (x, H - b.height))
        meta[n] = [x, H - b.height, b.width, b.height]
        x += b.width + 1
    base.save(OUT + 'sideline-base.png', optimize=True)
    mask.save(OUT + 'sideline-mask.png', optimize=True)
    return meta

if __name__ == '__main__':
    names = cut_players()
    meta = cut_stadium()
    side = cut_sideline()
    with open('apps/client/src/art-atlas.ts', 'w') as f:
        f.write('// Written by tools/cut-sprites.py. Do not edit by hand.\n')
        f.write(f'export const PLAYER_CELL = {{ w: {CELL_W}, h: {CELL_H} }};\n')
        f.write(f'export const PLAYER_FRAMES = {json.dumps(names)} as const;\n')
        f.write(f'export const STADIUM = {json.dumps(meta)};\n')
        f.write(f'export const SIDELINE: Record<string, number[]> = {json.dumps(side)};\n')
    print(len(names), 'player frames;', len(meta['ads']), 'sponsor boards;', len(meta['stands']), 'stands')
