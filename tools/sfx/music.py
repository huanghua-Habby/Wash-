"""Prepare background music: bake a bar-aligned loop crossfade, even out loudness, encode MP3.

The loop points were found with loopfind.py (tempo + spectral similarity, refined to the sample)
and checked against the beat grid. At runtime the AudioBufferSourceNode loops natively between
loopStart/loopEnd; the crossfade baked before loopEnd makes that jump seamless. A one-second pad of
the post-loopStart audio follows loopEnd, so any decoder priming shifts both points equally.
Usage: python music.py <menu.mp3> <game.mp3> <out_dir>
"""
import os, subprocess, sys, tempfile
import numpy as np, soundfile as sf, pyloudnorm

SR = 48000
TRACKS = {  # name: (loopStart, loopEnd) seconds
    'menu': (51.8337, 121.31),   # "Lazy Sunday Swing", 76 BPM, 22 bars
    'game': (7.5550, 101.19),    # "Swinging with the Band", 92.3 BPM, 36 bars
}
XFADE, PAD, TARGET_LUFS = 0.08, 1.0, -18.0

def decode(path):
    with tempfile.NamedTemporaryFile(suffix='.wav') as tmp:
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', path, '-map', '0:a', '-ar', str(SR), '-ac', '2', '-c:a', 'pcm_f32le', tmp.name], check=True)
        return sf.read(tmp.name)[0]

def build(src, name, out):
    s, e = TRACKS[name]; x = decode(src); si, ei, n = int(s * SR), int(e * SR), int(XFADE * SR)
    y = x[:ei].copy(); t = np.linspace(0, np.pi / 2, n)[:, None]
    y[ei - n:ei] = x[ei - n:ei] * np.cos(t) + x[si - n:si] * np.sin(t)   # tail flows into the loop start
    y = np.concatenate([y, x[si:si + int(PAD * SR)]])
    meter = pyloudnorm.Meter(SR); gain = 10 ** ((TARGET_LUFS - meter.integrated_loudness(y)) / 20)
    y = y * gain; peak = np.abs(y).max()
    if peak > 0.89: y *= 0.89 / peak   # keep −1 dBFS for the MP3 encoder's overshoot
    with tempfile.NamedTemporaryFile(suffix='.wav') as tmp:
        sf.write(tmp.name, y, SR, subtype='FLOAT')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', tmp.name, '-c:a', 'libmp3lame', '-q:a', '2', os.path.join(out, f'{name}.mp3')], check=True)
    print(f'{name}: {len(y) / SR:.2f}s, loop {s}→{e}, gain {20 * np.log10(gain):+.1f} dB, peak {20 * np.log10(np.abs(y).max()):.1f} dBFS')

if __name__ == '__main__':
    os.makedirs(sys.argv[3], exist_ok=True)
    build(sys.argv[1], 'menu', sys.argv[3]); build(sys.argv[2], 'game', sys.argv[3])
