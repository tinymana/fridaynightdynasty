"""Cuts the cut-in panels out of the artwork sheets in art/source. Run: python3 tools/cut-art.py"""
from PIL import Image
import os
SRC = 'art/source'
OUT = 'apps/client/src/assets/cutins'
PANELS = {
    '04_td_fg_cutscenes_pack.png': {
        'td-dive': (27, 27, 263, 170), 'td-burst': (275, 26, 511, 170), 'td-banner': (523, 28, 758, 170),
        'crowd': (27, 208, 263, 350), 'scoreboard-td': (791, 207, 1062, 350),
        'fg-good': (27, 585, 243, 727), 'fg-miss': (858, 585, 1034, 729), 'pat-good': (875, 407, 1082, 549),
        'kick-swing': (489, 408, 690, 549),
    },
    '03_cutscenes_pack.png': {
        'intercepted': (749, 31, 1024, 192), 'safety': (1066, 103, 1342, 186), 'sack': (52, 262, 323, 417),
        'halftime': (985, 472, 1137, 597), 'final': (1151, 472, 1343, 597), 'kickoff': (1129, 616, 1342, 737), 'helmet': (862, 616, 1113, 737),
    },
    'sheets3/10_high_school_cutscenes_1.png': {
        'n-runthrough': (28, 29, 540, 321), 'n-locker': (578, 299, 948, 540), 'n-fourth': (1035, 665, 1346, 738), 'n-rivalry-win': (1034, 577, 1347, 650),
    },
    'sheets3/11_high_school_cutscenes_2.png': {
        'n-bus': (29, 29, 580, 302), 'n-handshake': (28, 565, 328, 748), 'n-homecoming': (695, 577, 1015, 650),
        'n-overtime': (1035, 665, 1346, 738), 'n-rivalry': (1034, 577, 1347, 650),
    },
    'sheets3/13_high_school_cutscenes_3.png': {
        'n-cointoss': (28, 29, 460, 288), 'n-chalk': (490, 29, 906, 287), 'n-injury': (489, 322, 907, 542),
    },
    'sheets3/17_action_cutscenes.png': {
        'a-burst': (34, 28, 458, 276), 'a-pile': (476, 27, 900, 276), 'a-leap': (917, 29, 1342, 274),
        'a-throw': (37, 304, 455, 549), 'a-stiff': (536, 328, 873, 548), 'a-ref': (918, 301, 1342, 549),
        'a-cheer': (34, 565, 514, 741), 'a-touchdown': (561, 583, 934, 652), 'a-fumble': (975, 583, 1342, 652),
        'a-intercepted': (560, 665, 934, 734), 'a-sack': (975, 665, 1342, 734),
    },
}
FLATTEN = {'a-stiff'}
os.makedirs(OUT, exist_ok=True)
for sheet, panels in PANELS.items():
    im = Image.open(os.path.join(SRC, sheet)).convert('RGBA')
    for name, box in panels.items():
        cut = im.crop(box)
        if name in FLATTEN:
            # Drawn on a clear background: give it a night-sky panel so it reads as a picture over the field.
            panel = Image.new('RGBA', (cut.width + 24, cut.height + 16), (16, 22, 56, 255))
            panel.alpha_composite(cut, (12, 8))
            cut = panel
        cut.save(os.path.join(OUT, name + '.webp'), 'WEBP', quality=88, method=6)
        print(name, box[2] - box[0], box[3] - box[1], os.path.getsize(os.path.join(OUT, name + '.webp')))
