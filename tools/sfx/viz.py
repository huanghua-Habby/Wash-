"""Waveform + RMS(dB) + spectrogram plots with a fine time grid, for picking edit points."""
import sys, os, numpy as np, soundfile as sf, matplotlib
matplotlib.use("Agg"); import matplotlib.pyplot as plt
from scipy.signal import spectrogram

def load(p):
    x, sr = sf.read(p, always_2d=True); return x.mean(1), sr

def plot(paths, out, cols=1, start=None, end=None):
    n = len(paths); fig, axes = plt.subplots(n, 1, figsize=(16, 2.7 * n), squeeze=False)
    for ax, p in zip(axes[:, 0], paths):
        x, sr = load(p)
        if start is not None: x = x[int(start * sr):int(end * sr) if end else None]
        t = np.arange(len(x)) / sr + (start or 0)
        ax.plot(t, x, lw=0.4, color="#2a7fd4")
        hop = int(sr * 0.005); win = int(sr * 0.02)
        rms = np.sqrt(np.convolve(x ** 2, np.ones(win) / win, "same"))[::hop]
        db = 20 * np.log10(rms + 1e-9)
        ax2 = ax.twinx(); ax2.plot(t[::hop][:len(db)], db, color="#e2574c", lw=0.8); ax2.set_ylim(-80, 0)
        ax.set_xlim(t[0], t[-1]); ax.set_ylim(-1, 1)
        dur = t[-1] - t[0]; step = 0.05 if dur < 1.5 else 0.1 if dur < 4 else 0.5 if dur < 15 else 2
        ax.set_xticks(np.arange(round(t[0] / step) * step, t[-1], step)); ax.tick_params(labelsize=6)
        ax.grid(alpha=0.3)
        peak = np.abs(x).max()
        ax.set_title(f"{os.path.basename(p)}  sr={sr} dur={len(x)/sr:.3f}s peak={20*np.log10(peak+1e-9):.1f}dBFS", fontsize=9, loc="left")
        # Inset spectrogram on the lower band of the axis.
        ins = ax.inset_axes([0, -0.02, 1, 0.32]); 
        f, tt, S = spectrogram(x, sr, nperseg=1024, noverlap=768)
        ins.pcolormesh(tt + t[0], f, 10 * np.log10(S + 1e-12), shading="auto", cmap="magma", vmin=-120, vmax=-30)
        ins.set_yscale("symlog", linthresh=500); ins.set_ylim(60, sr / 2); ins.set_xlim(t[0], t[-1]); ins.axis("off")
    fig.tight_layout(); fig.savefig(out, dpi=80); plt.close(fig)

if __name__ == "__main__":
    args = sys.argv[1:]; s = e = None
    if args[0] == "--range": s, e = float(args[1]), float(args[2]); args = args[3:]
    plot(args[1:], args[0], start=s, end=e)
