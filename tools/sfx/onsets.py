import sys, numpy as np, soundfile as sf
def events(x, sr, thr_db=-30, gap=0.06):
    win = int(sr*0.005); env = np.sqrt(np.convolve(x**2, np.ones(win)/win, 'same'))
    db = 20*np.log10(env+1e-9); ref = db.max(); on = db > ref + thr_db
    out=[]; i=0; n=len(x)
    while i<n:
        if on[i]:
            j=i
            while j<n and (on[j] or (j+int(gap*sr)<n and on[j:j+int(gap*sr)].any())): j+=1
            seg=x[i:j]; out.append((i/sr, j/sr, 20*np.log10(np.abs(seg).max()+1e-9), 20*np.log10(np.sqrt((seg**2).mean())+1e-9)))
            i=j
        i+=1
    return out
for p in sys.argv[2:]:
    x, sr = sf.read(p); print('==', p)
    for a,b,pk,rm in events(x, sr, float(sys.argv[1])): print(f'  {a:7.3f}-{b:7.3f} ({(b-a)*1000:5.0f}ms) peak {pk:6.1f} rms {rm:6.1f}')
