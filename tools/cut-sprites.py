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

# Kicking-game frames from the special-teams sheet's red-and-silver row, drawn a little smaller there.
ST_ROW = (113, 190)
ST_SCALE = 0.45
ST_FRAMES = [('snap', 103, 173), ('hold', 356, 435), ('punt0', 615, 668), ('punt1', 669, 723)]

# Linemen from the linemen pack's red-and-silver row: down in a three-point stance, and driving off the snap.
LINE_ROW = (115, 190)
LINE_SCALE = 0.38
LINE_FRAMES = [('line', 268, 339), ('drive', 348, 440)]

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
    st = Image.open(SRC + '14_special_teams_pack_spritesheet.png').convert('RGBA')
    line = Image.open(SRC + '13_linemen_pack_spritesheet.png').convert('RGBA')
    every = [(n, x0, x1, sheet, ROW, SCALE) for n, x0, x1 in FRAMES] + [(n, x0, x1, st, ST_ROW, ST_SCALE) for n, x0, x1 in ST_FRAMES] + [(n, x0, x1, line, LINE_ROW, LINE_SCALE) for n, x0, x1 in LINE_FRAMES]
    base = Image.new('RGBA', (CELL_W * len(every), CELL_H), (0, 0, 0, 0))
    mask = Image.new('RGBA', (CELL_W * len(every), CELL_H), (0, 0, 0, 0))
    for i, (name, x0, x1, src, row, scale) in enumerate(every):
        fr = src.crop((x0, row[0], x1, row[1]))
        box = fr.getbbox()
        fr = fr.crop(box)
        w, h = min(CELL_W, max(1, round(fr.width * scale))), min(CELL_H, max(1, round(fr.height * scale)))
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
    return [f[0] for f in every]

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

# Cheerleaders, from the red squad's row of the cheer sheet (repainted per school): (name, x0, x1).
CHEER_ROW = (128, 204)
CHEER = [('pom0', 211, 272), ('pom1', 281, 343), ('wave0', 79, 122), ('wave1', 149, 192)]
# The marching band, from the red band's row (repainted per school): (name, x0, x1).
BAND_ROW = (114, 190)
BAND = [('major', 106, 166), ('brass0', 290, 333), ('brass1', 344, 390), ('sousa0', 471, 517), ('sousa1', 549, 595), ('snare0', 619, 661), ('bass0', 742, 794), ('guard0', 917, 974), ('guard1', 980, 1029)]
# The referee, in stripes: (name, x0, x1) in the first row of the referee sheet.
REF_ROW = (14, 130)
REFS = [('ref', 78, 137), ('refrun0', 213, 275), ('refrun1', 289, 359), ('reftd', 475, 534), ('refpoint', 639, 725), ('refflag', 1025, 1127)]

def cut_sideline():
    sheet = Image.open(SRC + '18_sideline_teams_spritesheet.png').convert('RGBA')
    crew = Image.open(SRC + '20_chain_gang_spritesheet.png').convert('RGBA')
    parts = [(n, *repaintable(sheet.crop((x0, SIDE_ROW[0], x1, SIDE_ROW[1])))) for n, x0, x1 in SIDE]
    cheer = Image.open(SRC + '06_cheerleaders_spritesheet.png').convert('RGBA')
    parts += [(n, *repaintable(cheer.crop((x0, CHEER_ROW[0], x1, CHEER_ROW[1])))) for n, x0, x1 in CHEER]
    band = Image.open(SRC + '16_marching_band_formations_spritesheet.png').convert('RGBA')
    parts += [(n, *repaintable(band.crop((x0, BAND_ROW[0], x1, BAND_ROW[1])))) for n, x0, x1 in BAND]
    refs = Image.open(SRC + '02_referees_spritesheet.png').convert('RGBA')
    for n, x0, x1 in REFS:
        fr = refs.crop((x0, REF_ROW[0], x1, REF_ROW[1]))
        fr = fr.crop(fr.getbbox())
        small = fr.resize((max(1, round(fr.width * 0.3)), max(1, round(fr.height * 0.3))), Image.LANCZOS)
        parts.append((n, small, Image.new('RGBA', small.size, (0, 0, 0, 0))))
    # The homecoming court, in their own clothes: (name, box).
    hc = Image.open(SRC + '17_homecoming_senior_night_spritesheet.png').convert('RGBA')
    for n, box in [('king', (18, 30, 58, 114)), ('queen', (66, 30, 110, 114)), ('court0', (284, 34, 332, 114)), ('court1', (348, 34, 396, 114)), ('court2', (416, 34, 464, 114)), ('court3', (476, 34, 548, 114)), ('hcbanner', (995, 105, 1345, 200))]:
        fr = hc.crop(box)
        fr = fr.crop(fr.getbbox())
        small = fr.resize((max(1, round(fr.width * 0.42)), max(1, round(fr.height * 0.42))), Image.LANCZOS)
        parts.append((n, small, Image.new('RGBA', small.size, (0, 0, 0, 0))))
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

# Turf wear, from the weather sheet: (name, box). Grass in the tile is keyed out so the mark can be stamped on any field.
TURF = [('mud0', (92, 52, 167, 126)), ('mud1', (8, 132, 82, 205)), ('mud2', (187, 132, 262, 205)), ('mud3', (272, 132, 347, 205)), ('mud4', (92, 132, 167, 205)),
        ('puddle0', (1218, 52, 1290, 126)), ('puddle1', (1297, 52, 1370, 126)), ('puddle2', (1218, 132, 1370, 205))]
COVER = [('snow', (403, 55, 467, 100)), ('frost', (750, 52, 822, 126))]

def cut_turf():
    sheet = Image.open(SRC + '15_dynamic_weather_turf_fog_spritesheet.png').convert('RGBA')
    parts = []
    for name, box in TURF:
        a = np.array(sheet.crop(box)).astype(int)
        r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
        grass = (g > r * 1.12) & (g > b * 1.12) & (g > 70)
        a[:, :, 3] = np.where(grass, 0, a[:, :, 3])
        t = Image.fromarray(a.astype(np.uint8))
        t = t.crop(t.getbbox())
        parts.append((name, t.resize((max(1, round(t.width * 0.5)), max(1, round(t.height * 0.5))), Image.LANCZOS)))
    for name, box in COVER:
        t = sheet.crop((box[0] + 3, box[1] + 3, box[2] - 3, box[3] - 3))
        parts.append((name, t.resize((32, 32), Image.LANCZOS)))
    # A soft round blob, used to trample snow back to grass.
    blob = Image.new('RGBA', (24, 24), (0, 0, 0, 0))
    bd = np.zeros((24, 24, 4), dtype=np.uint8)
    for y in range(24):
        for x in range(24):
            d = ((x - 11.5) ** 2 + (y - 11.5) ** 2) ** 0.5
            if d < 11: bd[y, x] = (255, 255, 255, 255 if d < 8 else int(255 * (11 - d) / 3))
    parts.append(('blob', Image.fromarray(bd)))
    H = max(t.height for _, t in parts)
    W = sum(t.width + 1 for _, t in parts)
    strip = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    meta = {}
    x = 0
    for name, t in parts:
        strip.paste(t, (x, 0)); meta[name] = [x, 0, t.width, t.height]; x += t.width + 1
    strip.save(OUT + 'turf.png', optimize=True)
    return meta

def cut_weather():
    """Rain, snow, mist and blowing leaves, as repeating tiles laid over the field by the page."""
    sheet = Image.open(SRC + '15_dynamic_weather_turf_fog_spritesheet.png').convert('RGBA')
    def save(name, box, mode):
        t = np.array(sheet.crop(box)).astype(int)
        r, g, b, a = t[:, :, 0], t[:, :, 1], t[:, :, 2], t[:, :, 3]
        lum = (r + g + b) // 3
        if mode == 'white':    # bright flakes on a dark ground: brightness becomes opacity
            out = np.dstack([np.full_like(r, 255)] * 3 + [np.clip((lum - 90) * 2.2, 0, 255) * (a > 40)])
        elif mode == 'fog':
            out = np.dstack([np.full_like(r, 235), np.full_like(r, 238), np.full_like(r, 245), np.clip((lum - 70) * 0.9, 0, 150) * (a > 40)])
        elif mode == 'colour':  # coloured leaves: keep them, drop the grey ground
            sat = np.max(t[:, :, :3], axis=2) - np.min(t[:, :, :3], axis=2)
            out = np.dstack([r, g, b, np.where((sat > 40) & (a > 40), 255, 0)])
        else:
            out = t
        Image.fromarray(out.astype(np.uint8)).save(OUT + f'wx-{name}.png', optimize=True)
    save('rain', (8, 262, 210, 335), 'asis')
    save('snow', (405, 262, 700, 335), 'white')
    save('fog', (824, 262, 1040, 330), 'fog')
    save('leaves', (1097, 262, 1232, 330), 'colour')

if __name__ == '__main__':
    names = cut_players()
    meta = cut_stadium()
    side = cut_sideline()
    turf = cut_turf()
    cut_weather()
    with open('apps/client/src/art-atlas.ts', 'w') as f:
        f.write('// Written by tools/cut-sprites.py. Do not edit by hand.\n')
        f.write(f'export const PLAYER_CELL = {{ w: {CELL_W}, h: {CELL_H} }};\n')
        f.write(f'export const PLAYER_FRAMES = {json.dumps(names)} as const;\n')
        f.write(f'export const STADIUM = {json.dumps(meta)};\n')
        f.write(f'export const SIDELINE: Record<string, number[]> = {json.dumps(side)};\n')
        f.write(f'export const TURF: Record<string, number[]> = {json.dumps(turf)};\n')
    print(len(names), 'player frames;', len(meta['ads']), 'sponsor boards;', len(meta['stands']), 'stands')
