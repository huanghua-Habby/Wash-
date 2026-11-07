"""Find a musically seamless loop (bar-aligned, spectrally matching) inside a song."""
import sys, numpy as np, soundfile as sf
from scipy.signal import stft
x, sr = sf.read(sys.argv[1]); lo_end, hi_end = float(sys.argv[2]), float(sys.argv[3]); min_len = float(sys.argv[4])
hop = 0.01; H = int(sr * hop)
f, t, Z = stft(x, sr, nperseg=2048, noverlap=2048 - H); S = np.abs(Z)
# Log-spaced band energies (timbre/harmony) and an onset envelope (rhythm).
edges = np.geomspace(60, 12000, 41); B = np.stack([S[(f >= a) & (f < b)].sum(0) for a, b in zip(edges[:-1], edges[1:])])
L = np.log1p(B * 50); onset = np.maximum(0, np.diff(L, axis=1)).sum(0); onset = np.r_[0, onset]
# Tempo from onset autocorrelation (70-200 BPM).
o = onset - onset.mean(); ac = np.correlate(o, o, 'full')[len(o) - 1:]
lags = np.arange(len(ac)) * hop; m = (lags > 60 / 200) & (lags < 60 / 70); beat = lags[m][ac[m].argmax()]
print(f'tempo {60 / beat:.2f} BPM (beat {beat:.4f}s)')
F = L / (np.linalg.norm(L, axis=0) + 1e-9)
W = int(3.0 / hop)  # compare 3 s on each side of the seam
best = (-1, 0, 0)
for end in np.arange(lo_end, hi_end, hop):
    e = int(end / hop)
    for lag_beats in range(int(min_len / beat), int(end / beat)):
        s = int(round((end - lag_beats * beat) / hop))
        if s - W < 0: break
        # Refine the lag by ±3 frames around the beat grid (tempo drift).
        for d in (-3, -2, -1, 0, 1, 2, 3):
            ss = s + d
            if ss - W < 0: continue
            sim = (F[:, e - W:e + W] * F[:, ss - W:ss + W]).sum(0).mean()
            if sim > best[0]: best = (sim, ss * hop, end)
sim, start, end = best
print(f'best loop: start {start:.3f}s -> end {end:.3f}s  length {end - start:.3f}s = {(end - start) / beat:.2f} beats  similarity {sim:.4f}')
# Sample-level refinement: align onset envelopes within ±30 ms.
s0, e0 = int(start * sr), int(end * sr); w = int(0.5 * sr); r = int(0.03 * sr)
env = lambda a: np.abs(a)
ref = env(x[e0 - w:e0 + w]); bestk, bestc = 0, -1
for k in range(-r, r, 8):
    c = np.dot(ref, env(x[s0 + k - w:s0 + k + w])); 
    if c > bestc: bestc, bestk = c, k
print(f'refined start {start + bestk / sr:.4f}s (shift {bestk / sr * 1000:+.1f} ms)')
