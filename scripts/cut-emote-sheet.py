import sys, numpy as np
from PIL import Image
from scipy import ndimage
src, out = sys.argv[1], sys.argv[2]
ids = ['nice','hi','help','here','sad','laugh','angry','wow']
rgb = np.asarray(Image.open(src).convert('RGB')).astype(np.float32)
H, W, _ = rgb.shape
border = np.concatenate([rgb[:6].reshape(-1,3), rgb[-6:].reshape(-1,3), rgb[:, :6].reshape(-1,3), rgb[:, -6:].reshape(-1,3)])
bg = np.median(border, 0); print('bg', bg)
dist = np.linalg.norm(rgb - bg, axis=2)
near = dist < 34
lab, n = ndimage.label(near)
touch = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
mask = np.isin(lab, list(touch))
# Enclosed gaps (life-ring hole, paw/face gaps): only nearly exact paper with no warm tint.
for i in range(1, n + 1):
    if i in touch: continue
    comp = lab == i
    size = comp.sum()
    if size > 150:
        m = dist[comp].mean()
        ys, xs = np.nonzero(comp)
        # The "here" pin's paper-white paw disc is art, not background; keep enclosed paper there.
        if ids[int(xs.mean()) // (W // 4) + 4 * (int(ys.mean()) // (H // 2))] == 'here': continue
        if m < 9:
            print("removed", size, round(float(m),1), int(xs.mean()), int(ys.mean()))
            mask |= comp
        if size > 1500: print('enclosed', i, size, round(float(m), 1))
alpha = np.ones((H, W), np.float32)
alpha[mask] = np.clip((dist[mask] - 10) / 24, 0, 1)
a3 = np.maximum(alpha, 1e-3)[..., None]
col = np.clip((rgb - bg * (1 - a3)) / a3, 0, 255)
rgba = np.dstack([col, alpha * 255]).astype(np.uint8)
cw, ch = W // 4, H // 2
boxes = []
for k in range(8):
    x0, y0 = (k % 4) * cw, (k // 4) * ch
    a = alpha[y0:y0 + ch, x0:x0 + cw] > 0.15
    a = ndimage.binary_opening(a, iterations=1)
    ys, xs = np.nonzero(a)
    boxes.append((x0 + xs.min(), y0 + ys.min(), x0 + xs.max() + 1, y0 + ys.max() + 1))
side = max(max(b[2] - b[0], b[3] - b[1]) for b in boxes)
S, pad = 256, 8
scale = (S - 2 * pad) / side
img = Image.fromarray(rgba, 'RGBA')
for k, (l, t, r, b) in enumerate(boxes):
    crop = img.crop((l, t, r, b))
    w, h = max(1, round((r - l) * scale)), max(1, round((b - t) * scale))
    crop = crop.resize((w, h), Image.LANCZOS)
    canvas = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    canvas.paste(crop, ((S - w) // 2, (S - h) // 2))
    canvas.save(f'{out}/{ids[k]}.png')
    print(ids[k], (l, t, r, b), (w, h))
