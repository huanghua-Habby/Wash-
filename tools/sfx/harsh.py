"""Comfort audit: share of energy in the ear's most sensitive 2-5 kHz band, energy above 6 kHz,
and the prominence of the strongest narrow tonal peak above 1 kHz (squeal / 'chalkboard' detector)."""
import sys, glob, os, numpy as np, soundfile as sf
from scipy.signal import welch, medfilt
def audit(x, sr=48000):
    f, P = welch(x, sr, nperseg=min(8192, len(x)))
    tot = P[(f > 60)].sum()
    harsh = P[(f >= 2000) & (f < 5000)].sum() / tot; air = P[f >= 6000].sum() / tot
    db = 10 * np.log10(P + 1e-15); smooth = medfilt(db, 31); m = f > 1000
    prom = (db - smooth)[m].max(); peak = f[m][(db - smooth)[m].argmax()]
    return harsh, air, prom, peak
if __name__ == '__main__':
    print(f"{'file':18} {'2-5k%':>6} {'>6k%':>6} {'tone dB':>8} {'at Hz':>7}")
    for p in sys.argv[1:]:
        for q in sorted(glob.glob(p)) if '*' in p else [p]:
            x, sr = sf.read(q); x = x.mean(1) if x.ndim > 1 else x
            h, a, pr, pk = audit(x, sr)
            flag = ' <-- harsh' if h > 0.25 or pr > 18 else ''
            print(f"{os.path.basename(q)[:-4]:18} {h*100:6.1f} {a*100:6.1f} {pr:8.1f} {pk:7.0f}{flag}")
