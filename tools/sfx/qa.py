import sys, glob, os, numpy as np, soundfile as sf
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import build as B
print(f"{'name':16} {'dur':>6} {'peak':>6} {'Lpk':>6} {'Lavg':>6} {'head':>6} {'tail':>6} {'tailN':>6} {'cent':>6} {'clip':>4} seam")
for p in sorted(glob.glob(sys.argv[1] + '/*.wav')):
    x, sr = sf.read(p); n = os.path.basename(p)[:-4]
    pk = 20*np.log10(np.abs(x).max()+1e-12)
    head = 20*np.log10(np.abs(x[:16]).max()+1e-9); tail = 20*np.log10(np.abs(x[-16:]).max()+1e-9)
    tn = 20*np.log10(np.sqrt(np.mean(x[-int(.02*sr):]**2))+1e-9)
    S = np.abs(np.fft.rfft(x*np.hanning(len(x)))); f = np.fft.rfftfreq(len(x), 1/sr); cent = (S*f).sum()/S.sum()
    clip = int((np.abs(x) > 0.995).sum())
    seam = ''
    if 'loop' in n:
        w = int(.03*sr); a = np.sqrt(np.mean(x[-w:]**2)); b = np.sqrt(np.mean(x[:w]**2))
        jump = abs(x[-1]-x[0]) / (np.std(x)+1e-9)
        seam = f"rmsΔ {20*np.log10(b/a):+.1f}dB  stepσ {jump:.2f}"
    print(f"{n:16} {len(x)/sr:6.3f} {pk:6.1f} {B.loud_peak(x):6.1f} {B.loud_avg(x):6.1f} {head:6.1f} {tail:6.1f} {tn:6.1f} {cent:6.0f} {clip:4d} {seam}")
