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
        'n-runthrough': (28, 29, 540, 321), 'n-locker': (578, 299, 948, 540), 'n-fourth': (1035, 665, 1346, 738),
    },
    'sheets3/11_high_school_cutscenes_2.png': {
        'n-bus': (29, 29, 580, 302), 'n-handshake': (28, 565, 328, 748), 'n-homecoming': (695, 577, 1015, 650),
        'n-overtime': (1035, 665, 1346, 738),
    },
    'sheets3/13_high_school_cutscenes_3.png': {
        'n-cointoss': (28, 29, 460, 288), 'n-chalk': (490, 29, 906, 287),
    },
}
os.makedirs(OUT, exist_ok=True)
for sheet, panels in PANELS.items():
    im = Image.open(os.path.join(SRC, sheet)).convert('RGBA')
    for name, box in panels.items():
        im.crop(box).save(os.path.join(OUT, name + '.webp'), 'WEBP', quality=88, method=6)
        print(name, box[2] - box[0], box[3] - box[1], os.path.getsize(os.path.join(OUT, name + '.webp')))
