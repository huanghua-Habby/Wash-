"""Derive extra WASH sounds by re-editing shipped files in client/assets/audio.

Those files are themselves edits of the CC0 BigSoundBank recordings (and the user's road_sign_hit source), so
these stay real-recording edits: varispeed, EQ, layering, fades and loudness only. Run after build.py (or alone:
it only reads already-shipped wavs); same inputs give byte-identical outputs.

    /tmp/sfxvenv/bin/python tools/sfx/derive.py [out_dir]
"""
import os, sys
import numpy as np, soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
AUDIO = os.path.join(HERE, "../../client/assets/audio")
out = sys.argv[1] if len(sys.argv) > 1 else AUDIO
sys.argv = sys.argv[:1] + [out]          # build.py reads its output directory from argv
sys.path.insert(0, HERE)
import build as B                          # noqa: E402  (shared editing helpers; build() is not run)

SR = B.SR

def wav(name):
    x, sr = sf.read(os.path.join(AUDIO, f"{name}.wav"), dtype="float64"); assert sr == SR
    return x - np.mean(x)

def head(x, seconds, pre=0.002):
    o = B.onset(x, -30); return x[max(0, o - int(pre * SR)):][: int(seconds * SR)]

def derive():
    meta = {}
    # --- Slap swing: the two rope swishes (dash 1795, throw 1796) sped up into one short, bright "fwip",
    #     with a little 1.2 kHz bite so it reads over music. Much louder than the soft dash it replaces.
    a = B.speed(head(wav("dash"), 0.3), 1.35)
    b = B.speed(head(wav("throw"), 0.45), 1.7)
    y = B.mix((a, 0, 0), (b, 0.012, -3))
    y = B.peq(B.soft(B.bq(y, "highpass", 320), 7000, -2), 1200, 3, 0.9)
    B.write("slap_swing", B.norm(B.fade(B.gate_tail(y, -48), 0.003, 0.05), -11), meta)

    # --- Slap hit: a punchy smack. The user's heavy impact (road_sign_hit) trimmed to its attack and sped up for
    #     snap, the body-fall + balloon smack (fall_hit) on top, and a landing thud for weight.
    heavy = B.speed(head(wav("road_sign_hit"), 0.26), 1.22)
    body = B.speed(head(wav("fall_hit"), 0.3), 1.3)
    thud = B.speed(head(wav("land_1"), 0.14), 0.9)
    y = B.mix((heavy, 0, 0), (body, 0.004, -3), (thud, 0.0, -6))
    y = B.peq(B.peq(B.soft(B.bq(y, "highpass", 45), 8500, -2), 110, 3, 0.8), 2600, 2, 1.2)
    B.write("slap_hit", B.norm(B.fade(B.gate_tail(y, -52), 0.001, 0.12), -8), meta)

    # --- Rival order complete (versus): the same music box, a minor third lower and slower, darkened, with a soft
    #     balloon thud in front: clearly "they scored", never confused with your own cheerful arpeggio.
    box = B.speed(wav("order_complete"), 0.84)
    thud = B.speed(head(wav("drop"), 0.12), 0.8)
    y = B.mix((thud, 0, -4), (box, 0.06, 0))
    y = B.peq(B.soft(B.bq(y, "highpass", 90), 2600, -4, order=4), 300, 2, 0.8)
    B.write("order_complete_rival", B.norm(B.fade(B.gate_tail(y, -55)[: int(2.4 * SR)], 0.002, 0.6), -17), meta)

    # --- Goose wing flap: two quick, dark rope whumps (throw 1796 slowed), like a big wing beat.
    w = B.soft(B.bq(B.speed(head(wav("throw"), 0.32), 0.82), "highpass", 110), 2400, -3, order=4)
    y = B.mix((w, 0, 0), (w, 0.085, -2))
    B.write("wing_flap", B.norm(B.fade(B.gate_tail(y, -48), 0.004, 0.06), -15), meta)
    return meta

if __name__ == "__main__":
    m = derive(); [print(f"  {k:22} {v['seconds']:.3f}s") for k, v in m.items()]
