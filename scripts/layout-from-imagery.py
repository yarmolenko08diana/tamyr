# Разметка посадок демо-района по спутниковому снимку бульвара Нуржол.
# Зоны участков нарисованы вручную по снимку (парк у Хан Шатыра, двор-кольцо, аллея бульвара),
# точки саженцев берутся преимущественно на кронах (тёмные зелёные пятна) внутри зон, не ближе ~8 м
# друг к другу, поэтому стоят не ровными рядами, а там, где на снимке растут деревья.
#
# Вход: скриншот карты в режиме «Спутник» и матрица привязки пикселей к координатам
# (аффинное преобразование, подобранное по положению маркеров старой разметки, ошибка < 1 px ≈ 2 м).
# Снимок Esri в репозиторий не кладём (лицензия), в репозитории только итог: data/nurzhol-layout.json.
# Нужны numpy, scipy, Pillow. Запуск: python3 scripts/layout-from-imagery.py screenshot.png affine.npy data/nurzhol-layout.json
import json, sys, numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

im = np.asarray(Image.open(sys.argv[1]).convert('RGB')).astype(float)
M = np.load(sys.argv[2])  # [lon, lat, 1] -> [x, y]
A = M[:2].T; b = M[2]
def px2ll(x, y):
    lon, lat = np.linalg.solve(A, np.array([x, y]) - b); return [round(lat, 6), round(lon, 6)]

L = im.mean(-1); R, G, B = im[..., 0], im[..., 1], im[..., 2]
crown = (L < ndimage.uniform_filter(L, 9) - 10) & (G >= R - 2) & (G > B + 5) & (L > 18)
crown = ndimage.binary_opening(crown, iterations=1)

def ring(cx, cy, r0, r1, a0, a1, n=24):
    out = [(cx + r1*np.cos(a), cy + r1*np.sin(a)) for a in np.linspace(a0, a1, n)]
    out += [(cx + r0*np.cos(a), cy + r0*np.sin(a)) for a in np.linspace(a1, a0, n)]
    return out

# Зоны в пикселях скриншота; «север» выше оси бульвара, «юг» ниже.
Z = {
 'P01': ([(362,229),(476,236),(478,330),(362,330)], 62),
 'P05': ([(362,336),(478,336),(480,410),(466,428),(360,428)], 62),
 'P02': (ring(570,362,0,50,np.pi*1.08,np.pi*1.92), 38),
 'P06': (ring(570,362,0,50,np.pi*0.08,np.pi*0.92), 38),
 'P03': ([(676,378),(766,386),(766,432),(676,426)], 32),
 'P07': ([(602,452),(660,456),(662,520),(602,518)], 30),
 'P04': ([(836,440),(1040,452),(1040,486),(836,474)], 40),
 'P08': ([(836,486),(922,490),(924,556),(836,552)], 34),
}
ROAD = lambda x, y: 553 <= x <= 575 and 300 <= y <= 420  # дорога через двор-кольцо

H, W = L.shape
rng = np.random.default_rng(7)
MIN = 4.2  # пикселей ≈ 8,5 м
out = {}
dbg = Image.fromarray(im.astype(np.uint8)); dr = ImageDraw.Draw(dbg)
for pid, (poly, n) in Z.items():
    m = Image.new('L', (W, H), 0); ImageDraw.Draw(m).polygon(poly, fill=1)
    inside = np.asarray(m).astype(bool)
    inside = ndimage.binary_erosion(inside, iterations=2)
    ys, xs = np.nonzero(inside)
    keep = np.array([not ROAD(x, y) for x, y in zip(xs, ys)])
    ys, xs = ys[keep], xs[keep]
    w = np.where(crown[ys, xs], 6.0, 1.0)
    order = rng.choice(len(xs), size=len(xs), replace=False, p=w/w.sum())
    pts = []
    for k in order:
        x, y = xs[k] + rng.uniform(-.5, .5), ys[k] + rng.uniform(-.5, .5)
        if all((x-a)**2 + (y-c)**2 >= MIN**2 for a, c in pts):
            pts.append((x, y))
            if len(pts) == n: break
    pts.sort(key=lambda p: (p[0], p[1]))
    dr.polygon(poly, outline=(255, 255, 0))
    for x, y in pts: dr.ellipse((x-2, y-2, x+2, y+2), fill=(0, 255, 255))
    poly_s = poly[::max(1, len(poly)//16)] if len(poly) > 8 else poly
    xs_, ys_ = [p[0] for p in poly], [p[1] for p in poly]
    north = pid in ('P01', 'P02', 'P03', 'P04')
    lx = sum(xs_) / len(xs_); ly = min(ys_) - 9 if north else max(ys_) + 9
    out[pid] = {'polygon': [px2ll(x, y) for x, y in poly_s],
                'label': px2ll(lx, ly),
                'points': [px2ll(x, y) for x, y in pts]}
    print(pid, len(pts))
if len(sys.argv) > 4: dbg.save(sys.argv[4])
json.dump(out, open(sys.argv[3], 'w'), indent=1)
