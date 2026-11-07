"""Edit real CC0 recordings (BigSoundBank) into the WASH game's sound set.

Every output is cut from an actual recording; processing is limited to editing
(trim, varispeed/pitch glide, EQ, layering, fades, loop crossfades, loudness).
"""
import json, os, subprocess, sys
import numpy as np, soundfile as sf
from math import gcd
from scipy.signal import butter, sosfilt, sosfiltfilt, resample_poly, lfilter

SR = 48000
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.environ.get("SFX_SRC", "/tmp/sfxwork/src")  # filled by fetch_sources.sh
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "../../client/assets/audio")
os.makedirs(OUT, exist_ok=True)
_cache = {}

def load(i):
    if i not in _cache:
        x, sr = sf.read(f"{SRC}/{i}.wav", dtype="float64"); assert sr == SR
        _cache[i] = x - np.mean(x)  # remove DC
    return _cache[i]

def user(name):
    """A user-supplied file kept in tools/sfx/user (decoded with ffmpeg to 48 kHz mono)."""
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", os.path.join(HERE, "user", name), "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)

def cut(i, t0, t1):
    x = load(i); return x[int(t0 * SR):int(t1 * SR)].copy()

def onset(x, thr_db=-24):
    """First sample whose 1 ms envelope rises within thr_db of the peak."""
    w = int(SR * 0.001); env = np.sqrt(np.convolve(x ** 2, np.ones(w) / w, "same"))
    return int(np.argmax(env > env.max() * 10 ** (thr_db / 20)))

def hit(i, t, dur, pre=0.004, thr_db=-24):
    """Cut an event near t, aligned so its attack starts `pre` seconds in."""
    x = cut(i, max(0, t - 0.05), t + dur + 0.05)
    o = onset(x, thr_db); s = max(0, o - int(pre * SR))
    return x[s:s + int((dur + pre) * SR)]

def speed(x, r):
    """Tape-style varispeed: r > 1 is higher and shorter."""
    if abs(r - 1) < 1e-6: return x
    up, down = 1000, int(round(1000 * r)); g = gcd(up, down)
    return resample_poly(x, up // g, down // g)

def glide(x, r0, r1, curve=1.0):
    """Varispeed whose rate moves from r0 to r1 across the clip (a pitch bend on the real sound)."""
    os4 = resample_poly(x, 4, 1)  # oversample so linear interpolation stays clean
    n = len(x); pos = [0.0]; p = 0.0
    while p < n - 1:
        k = (p / n) ** curve; r = r0 + (r1 - r0) * k; p += r; pos.append(p)
    pos = np.array(pos[:-1]) * 4
    y = np.interp(pos, np.arange(len(os4)), os4)
    return y

def bq(x, kind, f, order=2):  # noqa: order 4 is used for steep muffling
    sos = butter(order, f, kind, fs=SR, output="sos"); return sosfilt(sos, x)

def peq(x, f, gain_db, q=1.0):
    A = 10 ** (gain_db / 40); w = 2 * np.pi * f / SR; al = np.sin(w) / (2 * q)
    b = [1 + al * A, -2 * np.cos(w), 1 - al * A]; a = [1 + al / A, -2 * np.cos(w), 1 - al / A]
    return lfilter(np.array(b) / a[0], np.array(a) / a[0], x)

def fade(x, fin=0.002, fout=0.02, shape=2.0):
    x = x.copy(); a = int(fin * SR); b = int(fout * SR)
    if a: x[:a] *= np.linspace(0, 1, a) ** 2
    if b: x[-b:] *= np.linspace(1, 0, b) ** shape
    return x

def gate_tail(x, floor_db=-50, release=0.03):
    """Downward expander: pulls recorded room noise under floor_db towards silence (smooth, no chatter)."""
    w = int(SR * 0.01); env = np.sqrt(np.convolve(x ** 2, np.ones(w) / w, "same")) + 1e-12
    db = 20 * np.log10(env / (np.abs(x).max() + 1e-12))
    g = np.clip((db - floor_db) / 12 + 1, 0, 1)  # 12 dB soft knee below the floor
    a = np.exp(-1 / (release * SR)); out = np.empty_like(g); s = 1.0
    for k in range(len(g)):
        s = g[k] if g[k] > s else a * s + (1 - a) * g[k]; out[k] = s  # instant open, smooth close
    return x * out

def db(v): return 10 ** (v / 20)

def bloop_pitch(x):
    """Median dominant frequency (300-3000 Hz) of a short tonal bloop."""
    n = int(0.008 * SR); track = []
    for i in range(0, len(x) - 2 * n, n // 2):
        w = x[i:i + 2 * n] * np.hanning(2 * n)
        if np.sqrt((w ** 2).mean()) < 1e-3: continue
        S = np.abs(np.fft.rfft(w, 16384)); f = np.fft.rfftfreq(16384, 1 / SR); m = (f > 300) & (f < 3000)
        track.append(f[m][S[m].argmax()])
    return float(np.median(track))

def soft(x, lowpass=5000, dip=-3, order=2):
    """ASMR shaping: round off the top and pull down the ear's most sensitive band (~3.2 kHz)."""
    return peq(bq(x, "lowpass", lowpass, order), 3200, dip, 0.8)

def mix(*layers):
    """layers: (signal, offset_seconds, gain_db)"""
    n = max(int(o * SR) + len(s) for s, o, _ in layers); y = np.zeros(n)
    for s, o, g in layers: k = int(o * SR); y[k:k + len(s)] += s * db(g)
    return y

def kweight(x):
    # ITU-R BS.1770 pre-filter (high shelf) + RLB high-pass at 48 kHz.
    b1 = [1.53512485958697, -2.69169618940638, 1.19839281085285]; a1 = [1, -1.69065929318241, 0.73248077421585]
    b2 = [1.0, -2.0, 1.0]; a2 = [1, -1.99004745483398, 0.99007225036621]
    return lfilter(b2, a2, lfilter(b1, a1, x))

def loud_peak(x, win=0.05):
    """Max short-window K-weighted loudness (LUFS-like) — fair for very short one-shots."""
    k = kweight(x); w = int(win * SR)
    ms = np.convolve(k ** 2, np.ones(w) / w, "valid") if len(k) > w else [np.mean(k ** 2)]
    return -0.691 + 10 * np.log10(np.max(ms) + 1e-12)

def loud_avg(x):
    k = kweight(x); return -0.691 + 10 * np.log10(np.mean(k ** 2) + 1e-12)

def limit(x, ceiling_db=-1.0, release=0.05):
    """Look-ahead peak limiter (2 ms), so loudness targets never clip."""
    c = db(ceiling_db); la = int(0.002 * SR)
    need = np.minimum(1, c / (np.abs(x) + 1e-12))
    # running min over the look-ahead window, then smooth release
    from scipy.ndimage import minimum_filter1d
    g = minimum_filter1d(need, size=2 * la + 1, origin=0)
    a = np.exp(-1 / (release * SR)); out = np.empty_like(g); s = 1.0
    for k in range(len(g)):
        s = g[k] if g[k] < s else a * s + (1 - a) * g[k]; out[k] = s
    return np.clip(x * out, -c, c)

def norm(x, target, mode="peak", max_gr=3.0, ceiling=-1.0):
    """Hit the loudness target, but never let the limiter take more than max_gr dB off a transient."""
    cur = loud_peak(x) if mode == "peak" else loud_avg(x)
    gain = target - cur
    peak = 20 * np.log10(np.abs(x).max() + 1e-12)
    gain = min(gain, ceiling + max_gr - peak)
    return limit(x * db(gain), ceiling)

def circular(length, *events):
    """Rhythmic loop built on a ring buffer: each event's tail wraps to the start, so the seam is exact."""
    n = int(length * SR); y = np.zeros(n)
    for s, o, g in events:
        k = int(o * SR) % n; s = s * db(g)
        while len(s):
            m = min(len(s), n - k); y[k:k + m] += s[:m]; s = s[m:]; k = 0
    return y

def bed(i, t0, length, xfade=0.15):
    """A continuous recorded bed of exactly `length` seconds that loops seamlessly."""
    return loopify(cut(i, t0, t0 + length + xfade), xfade)

def loopify(x, xfade=0.2):
    """Seamless loop: equal-power crossfade of the tail into the head."""
    n = int(xfade * SR); t = np.linspace(0, np.pi / 2, n)
    body = x[n:].copy(); head = x[:n]
    body[-n:] = body[-n:] * np.cos(t) + head * np.sin(t)
    return body

def write(name, x, meta):
    x = np.asarray(x, dtype=np.float64)
    rng = np.random.default_rng(len(name))
    tpdf = (rng.random(len(x)) - rng.random(len(x))) / 32768.0  # TPDF dither before 16-bit
    sf.write(f"{OUT}/{name}.wav", np.clip(x + tpdf, -1, 1), SR, subtype="PCM_16")
    meta[name] = {"seconds": round(len(x) / SR, 3)}

def build():
    meta = {}
    # --- Jump: a real water "bloop" slowed into a rubbery boing, with a springy upward bend
    #     and a faint rope whoosh for lift.
    whoosh_s = bq(speed(cut("1799", 0.12, 0.42), 1.45), "highpass", 300)
    for k, t in enumerate([0.188, 4.329, 11.985]):
        b = hit("1074", t, 0.045, pre=0.002)
        b = glide(b, 0.50, 0.66, 0.8)           # ~350→600 Hz rising "bwoop"
        b = peq(bq(b, "highpass", 120), 2500, -3, 0.8)
        y = mix((b, 0, 0), (whoosh_s, 0.005, -13))
        write(f"jump_{k + 1}", norm(fade(gate_tail(y, -48), 0.001, 0.03), -14), meta)

    # --- Landing: balloon rebounds = plush, bouncy thud. Slowed, warm body, rounded top (no ringing squeak).
    for k, (src, t, r) in enumerate([("1045", 0.176, 0.82), ("1045", 3.108, 0.86), ("1825", 0.05, 0.9)]):
        h = speed(hit(src, t, 0.16 if src == "1045" else 0.105, pre=0.002), r)
        h = peq(soft(bq(h, "highpass", 60), 4500, -4), 180, 3, 0.9)
        write(f"land_{k + 1}", norm(fade(gate_tail(h, -50), 0.002, 0.05), -13), meta)

    # --- Fall onto the road: body fall impact + slowed balloon smack for the "splat-boing".
    body = cut("2453", 0.40, 1.0); pk = int(np.argmax(np.abs(body))); body = body[max(0, pk - int(0.02 * SR)):][: int(0.45 * SR)]
    smack = speed(hit("1045", 5.879, 0.2, pre=0.003), 0.7)
    y = mix((bq(body, "highpass", 50), 0, 0), (bq(smack, "lowpass", 5000), 0.0, -2))
    y = peq(soft(y, 6000, -3), 120, 3, 0.8)
    write("fall_hit", norm(fade(gate_tail(y, -52), 0.003, 0.12), -10), meta)
    for k, (t, r) in enumerate([(1.093, 1.0), (3.942, 1.08)]):
        h = speed(hit("1045", t, 0.12, pre=0.002), r)
        write(f"fall_bounce_{k + 1}", norm(fade(gate_tail(soft(bq(h, "highpass", 80), 4500, -4), -48), 0.002, 0.04), -17), meta)
    mew = speed(cut("1473", 0.06, 0.92), 1.12)
    write("mew", norm(fade(gate_tail(soft(bq(mew, "highpass", 250), 5000, -3), -45), 0.01, 0.12), -20), meta)

    # --- Item pickup: champagne-cork pop with a round, resonant body.
    cork = speed(hit("0648", 0.22, 0.2, pre=0.002), 1.15)
    write("pickup_1", norm(fade(gate_tail(soft(bq(cork, "highpass", 200), 6000, -3), -46), 0.002, 0.04), -16), meta)
    d = speed(hit("1826", 0.01, 0.12, pre=0.002), 0.92)
    write("drop", norm(fade(gate_tail(soft(bq(d, "highpass", 90), 4500, -4), -48), 0.002, 0.04), -17), meta)
    w = soft(bq(speed(cut("1796", 0.16, 0.78), 1.2), "highpass", 140), 6000, -2)
    write("throw", norm(fade(w, 0.01, 0.12), -16), meta)
    w = soft(bq(speed(cut("1795", 0.15, 0.6), 1.45), "highpass", 220), 6000, -2)
    write("dash", norm(fade(w, 0.008, 0.08), -17), meta)
    s = speed(cut("2280", 0.10, 0.95), 1.12)
    write("slip", norm(fade(soft(bq(s, "highpass", 120), 6000, -3), 0.002, 0.25), -16), meta)

    # --- Footsteps: only the soft first pat of slipper steps, pitched up to paw size, very dark.
    for k, t in enumerate([7.286, 0.861, 2.269, 3.675]):
        p = speed(hit("0373", t, 0.075, pre=0.003, thr_db=-30), 1.35)
        p = soft(bq(p, "highpass", 160), 2800, -6)
        write(f"step_{k + 1}", norm(fade(gate_tail(p, -46), 0.003, 0.035), -24), meta)

    # --- Water gun: the nozzle stream (softened), plus surface-specific impact loops.
    jet = soft(bq(cut("0326", 7.40, 10.20), "highpass", 140), 4500, -5, 4)
    write("spray_loop", norm(loopify(jet, 0.35), -27, "avg"), meta)
    a = hit("0326", 6.85, 0.3, pre=0.004, thr_db=-12)
    write("spray_start", norm(fade(soft(bq(a, "highpass", 140), 6000, -4), 0.004, 0.16), -20), meta)
    # Road: dense shower spray splattering on a hard floor.
    g = soft(bq(cut("0171", 34.0, 37.4), "highpass", 120), 3500, -5, 4)
    write("splash_ground_loop", norm(loopify(g, 0.4), -25, "avg"), meta)
    # Vehicle: heavy rain drumming on a car roof — hollow metal body, rounded top.
    v = peq(soft(bq(cut("1293", 60.0, 63.4), "highpass", 90), 4500, -4), 320, 4, 0.9)
    write("splash_truck_loop", norm(loopify(v, 0.4), -25, "avg"), meta)
    # Stain: muddy slosh — slow rowing swirls over a soft faucet bed, low and wet.
    sl = [fade(hit("1514", t, d, pre=0.01, thr_db=-30), 0.02, 0.15) for t, d in [(3.116, 0.6), (5.598, 0.8), (8.483, 0.85)]]
    L = 2.6
    tap = bed("0652", 13.9, L, 0.3)
    y = circular(L, (tap, 0, -8), *[(s, i * 0.87, -2) for i, s in enumerate(sl)])
    write("splash_stain_loop", norm(soft(bq(y, "highpass", 100), 3500, -4), -25, "avg"), meta)
    # A cat: the same shower muffled, like water on fur.
    c = bq(bq(cut("0171", 20.0, 23.4), "highpass", 150), "lowpass", 2200, 4)
    write("splash_cat_loop", norm(loopify(c, 0.4), -27, "avg"), meta)

    # --- Soap scrub: wet sponge squishes over a soft bed of straw bubbles.
    squish = [hit("0778", t, d, pre=0.01, thr_db=-30) for t, d in [(0.638, 0.34), (4.561, 0.34), (8.777, 0.24), (1.207, 0.42)]]
    squish = [fade(speed(s, 1.05), 0.015, 0.06) for s in squish]
    L = 2.2
    bubbles = bed("0183", 6.7, L, 0.25)
    y = circular(L, (bubbles, 0, -10), *[(s, 0.02 + i * 0.55, 0) for i, s in enumerate(squish)])
    write("soap_loop", norm(soft(bq(y, "highpass", 120), 4500, -5), -26, "avg"), meta)

    # --- Towel wipe: soft hand-on-cloth rubbing (ASMR), no squeak; four strokes per loop.
    strokes = [hit("0663", t, d, pre=0.02, thr_db=-30) for t, d in [(3.423, 0.40), (5.223, 0.33), (5.778, 0.36), (15.802, 0.40)]]
    strokes = [fade(s, 0.04, 0.08) for s in strokes]
    L = 1.68
    swish = bed("1104", 5.65, L, 0.2)
    y = circular(L, (swish, 0, -14), *[(s, 0.01 + i * 0.42, 0) for i, s in enumerate(strokes)])
    y = peq(soft(bq(y, "highpass", 150), 2200, -4, 4), 400, 3, 0.8)   # warm "shh-shh", nothing piercing
    write("wipe_loop", norm(y, -26, "avg"), meta)
    # Rinsing the towel at the sink: kitchen faucet, warm.
    rinse = soft(bq(cut("0652", 13.9, 17.4), "highpass", 120), 4500, -4)
    write("rinse_loop", norm(loopify(rinse, 0.3), -27, "avg"), meta)

    # --- Progress: single water bloops of matching pitch (~840-1020 Hz); the game fires them in a stream
    #     and raises their playback rate with the stain's cleaning, so the bubbling climbs from low to high.
    for k, t in enumerate([0.188, 4.329, 5.728, 7.032, 11.985, 33.003]):
        b = hit("1074", t, 0.045, pre=0.002)
        b = speed(b, 900 / bloop_pitch(b))       # tune every variant to 900 Hz so the climb is monotonic
        write(f"progress_bubble_{k + 1}", norm(fade(gate_tail(soft(bq(b, "highpass", 250), 5000, -2), -48), 0.002, 0.02), -21), meta)

    # --- Stain stage finished: a double water bloop.
    for k, (t1, t2) in enumerate([(15.543, 19.248), (17.998, 23.097), (24.411, 38.353)]):
        b1 = hit("1074", t1, 0.04, pre=0.002); b2 = speed(hit("1074", t2, 0.04, pre=0.002), 1.12)
        y = mix((b1, 0, 0), (b2, 0.07, -2))
        write(f"pop_{k + 1}", norm(fade(gate_tail(soft(bq(y, "highpass", 300), 5000, -2), -48), 0.002, 0.03), -17), meta)
    # Stain fully clean: one short, crisp glass "ting" (single champagne-flute clink), air above 12 kHz trimmed.
    ting = bq(bq(hit("1336", 0.029, 0.32, pre=0.002), "highpass", 600), "lowpass", 12000)
    write("clean", norm(fade(gate_tail(ting, -55), 0.001, 0.18), -17), meta)

    # --- Order complete: music-box arpeggio G#4 C5 D#5 C6 (A-flat major), every note under 1.1 kHz.
    notes = [(hit(i, 0.0, 1.8, pre=0.002, thr_db=-30), t, g) for i, t, g in [("1865", 0, 0), ("1867", 0.11, -1), ("1869", 0.22, -1), ("1874", 0.36, -2)]]
    y = mix(*[(fade(n, 0.002, 0.8), t, g) for n, t, g in notes])
    write("order_complete", norm(fade(gate_tail(soft(y, 6000, -3), -55)[: int(2.3 * SR)], 0.002, 0.6), -15), meta)

    # --- Round over: party horn + short applause (kept as the original celebratory ending).
    horn = cut("1553", 0.03, 0.95)
    clap = cut("2363", 0.3, 3.6)
    y = mix((fade(horn, 0.005, 0.1), 0, 0), (fade(clap, 0.02, 1.4), 0.25, -6))
    write("round_end", norm(y, -12), meta)

    # --- Road sign whoosh: a car pass-by squeezed 5x into a ~1.2 s rushing gust (the doppler swell peaks
    #     ~0.4 s in, when the sign reaches the cats), plus a slowed rope swish at the peak for the cut air.
    passby = bq(speed(cut("2987", 4.2, 10.2), 5.0), "highpass", 180)
    swish = bq(speed(cut("1801", 0.26, 0.6), 0.72), "highpass", 250)
    pk = int(np.argmax(np.abs(swish)))
    y = mix((passby, 0, 0), (swish, max(0, 0.40 - pk / SR), -4))
    write("road_sign_whoosh", norm(fade(soft(y, 5500, -4), 0.06, 0.35), -14), meta)
    # --- Road sign hit: the user-supplied heavy impact (tools/sfx/user), trimmed to its attack; the decoded mp3
    #     overs are scaled under full scale before the limiter, and the top is softened.
    h = user("heavy_player_hit_2.mp3"); o = onset(h, -30); h = h[max(0, o - int(0.002 * SR)):][: int(0.7 * SR)]
    h = h / np.abs(h).max() * 0.9
    write("road_sign_hit", norm(fade(gate_tail(peq(soft(bq(h, "highpass", 45), 9000, -2), 110, 1.5, 0.8), -55), 0.001, 0.2), -9), meta)

    # --- Order vehicles: a spaceship pass-by. Arrival = its approach swell (~2.5 s, the merge flight) ending in a
    #     cheery double horn as it docks; departure = one toot, then the pass-by receding from its peak, sped up.
    toot = speed(hit("0257", 0.03, 0.17, pre=0.002), 1.08)
    toot = peq(soft(bq(fade(toot, 0.004, 0.05), "highpass", 250), 5000, -3), 2000, -4, 1.2)
    approach = fade(bq(cut("2033", 1.6, 4.15), "highpass", 90), 0.3, 0.25)
    end = len(approach) / SR
    y = mix((approach, 0, 0), (toot, end - 0.05, -5), (toot, end + 0.17, -5))
    write("vehicle_arrive", norm(fade(soft(y, 7000, -3), 0.002, 0.08), -16), meta)
    away = bq(speed(cut("2033", 3.95, 7.0), 1.2), "highpass", 90)
    y = mix((toot, 0, -6), (fade(away, 0.06, 0.6), 0.12, 0))
    write("vehicle_leave", norm(soft(y, 7000, -3), -16), meta)

    # --- Electrified puddle: arc-welder sizzle (slowed to 0.8 so its 100 Hz arc buzz turns into a fat "zzz") over an
    #     amplifier's 50 Hz mains hum, with speaker-shock crackle bursts for the "刺啦刺啦" rhythm. 3.2 kHz scooped.
    L = 2.6
    zap = lambda x: peq(soft(bq(speed(x, 0.8), "highpass", 45), 5000, -10), 150, 2, 0.8)
    arc = loopify(zap(cut("0950", 6.0, 6.0 + (L + 0.3) * 0.8)), 0.3)
    hum = loopify(bq(bq(cut("2006", 10.0, 10.0 + L + 0.2), "highpass", 40), "lowpass", 900, 4), 0.2)
    arc = arc * db(-26 - loud_avg(arc)); hum = hum * db(-26 - loud_avg(hum))   # level-match the beds
    cr = [fade(zap(cut("0134", a, b)), 0.004, 0.05) for a, b in [(8.90, 9.07), (9.37, 9.69), (25.43, 25.62)]]
    y = circular(L, (arc, 0, 0), (hum, 0, -10), (cr[0], 0.35, -6), (cr[1], 1.25, -7), (cr[2], 2.05, -6))
    write("electric_loop", norm(y, -26, "avg"), meta)

    # --- Shock: an electric-fence snap, then a speaker shock's sputtering buzz and welding crackle that die away.
    snap = hit("1252", 1.695, 0.06, pre=0.001)
    buzz = cut("0134", 25.42, 26.40)
    crk = cut("0952", 2.76, 3.56)
    y = mix((snap, 0, -3), (fade(buzz, 0.003, 0.3), 0.02, -3), (fade(crk, 0.003, 0.35), 0.01, -6))
    y = peq(soft(bq(y, "highpass", 60), 5000, -5, 4), 120, 2, 0.8)
    write("shock_zap", norm(fade(gate_tail(y, -50), 0.001, 0.4, 1.5), -13, max_gr=5), meta)

    # --- Short circuit blowout: a fence-zap crack into a slowed bird-scarer bang (soft whoomp), the distant
    #     explosion's rolling tail for smoke, and a few dying crackles.
    snap = hit("1252", 3.254, 0.06, pre=0.001)
    boom = speed(hit("1808", 0.0, 0.33, pre=0.002), 0.42)
    boom = peq(bq(bq(boom, "highpass", 40), "lowpass", 1800, 4), 90, 3, 0.8)
    tail = speed(cut("1023", 0.12, 2.0), 0.85)
    tail = bq(bq(tail, "highpass", 60), "lowpass", 1500, 4)
    spit = fade(cut("0134", 9.37, 9.69), 0.004, 0.1)
    y = mix((snap, 0, -2), (boom, 0.025, 0), (fade(tail, 0.1, 0.8), 0.06, -1), (spit, 0.40, -12))
    y = soft(y, 6000, -4)
    write("short_explosion", norm(fade(gate_tail(y, -55)[: int(1.7 * SR)], 0.001, 0.6), -10), meta)

    # --- Plug blasted out: a plastic stopper pop, a slowed brass cartridge-case ping for the metal prongs,
    #     and a quick tube whoosh as it flies off.
    pop = speed(hit("0274", 0.0, 0.12, pre=0.001), 1.1)
    ping = speed(hit("1355", 0.076, 0.11, pre=0.001), 0.5)
    ping = bq(bq(ping, "highpass", 600), "lowpass", 6000)
    wh = bq(cut("1801", 0.22, 0.60), "highpass", 300)
    y = mix((pop, 0, 0), (fade(ping, 0.001, 0.12), 0.004, -2), (fade(wh, 0.03, 0.12), 0.05, -5))
    y = soft(bq(y, "highpass", 120), 6000, -4)
    write("plug_pop", norm(fade(gate_tail(y, -50), 0.001, 0.08), -15), meta)

    # --- UI: a soft bloop.
    u = speed(hit("1074", 10.776, 0.07, pre=0.001), 1.2)
    write("ui_click", norm(fade(gate_tail(soft(bq(u, "highpass", 400), 5000, -2), -45), 0.002, 0.02), -21), meta)

    return meta

if __name__ == "__main__":
    m = build(); print(len(m), "sounds"); [print(f"  {k:16} {v['seconds']:.3f}s") for k, v in m.items()]
