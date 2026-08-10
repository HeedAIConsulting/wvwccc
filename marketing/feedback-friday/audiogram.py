import sys, json, math, wave, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import imageio_ffmpeg

FORMAT = sys.argv[1] if len(sys.argv) > 1 else "vertical"  # vertical | feed
if FORMAT == "vertical":
    W, H = 1080, 1920
    LOCKUP_Y, WAVE_Y, TEXT_Y, ATTR_Y = 330, 800, 1060, 1420
    OUT = "audiogram_vertical.mp4"
else:
    W, H = 1080, 1350
    LOCKUP_Y, WAVE_Y, TEXT_Y, ATTR_Y = 150, 560, 810, 1160
    OUT = "audiogram_feed.mp4"

FPS = 24
BG = (15, 15, 19)
INK = (240, 238, 232)
GOLD = (245, 179, 30)
DIM = (120, 120, 128)

FDIR = "/usr/share/fonts/truetype/liberation/"
title_font = ImageFont.truetype(FDIR + "LiberationSans-Bold.ttf", 64)
sub_font = ImageFont.truetype(FDIR + "LiberationSans-Bold.ttf", 34)
word_font = ImageFont.truetype(FDIR + "LiberationSans-Bold.ttf", 60)
attr_font = ImageFont.truetype(FDIR + "LiberationSans-Bold.ttf", 38)

words = json.load(open("tts_words.json"))  # [[start, end, word], ...]

# ---- audio envelope ----
wf = wave.open("tts_16k.wav", "rb")
sr = wf.getframerate()
raw = np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16).astype(np.float32)
wf.close()
DUR = len(raw) / sr + 1.6  # hold after speech
hop = sr // FPS
win = int(0.05 * sr)
n_frames_audio = len(raw) // hop
env = np.zeros(n_frames_audio)
for i in range(n_frames_audio):
    seg = raw[i * hop: i * hop + win]
    env[i] = np.sqrt(np.mean(seg ** 2)) if len(seg) else 0
env /= max(np.percentile(env, 97), 1e-6)
env = np.clip(env, 0, 1)
env = np.convolve(env, np.ones(3) / 3, mode="same")

def env_at(t):
    i = int(t * FPS)
    return env[i] if 0 <= i < len(env) else 0.0

# ---- word pages (max 2 lines each) ----
measurer = ImageDraw.Draw(Image.new("RGB", (8, 8)))
MAXW = W - 240
pages = []  # each: list of (start, end, word, line_idx)
cur, lines, line, linew = [], 0, [], 0.0
for s, e, w in words:
    wl = measurer.textlength(w + " ", font=word_font)
    if linew + wl > MAXW:
        lines += 1
        line, linew = [], 0.0
        if lines >= 2:
            pages.append(cur)
            cur, lines = [], 0
    cur.append((s, e, w, lines))
    line.append(w)
    linew += wl
if cur:
    pages.append(cur)

def page_at(t):
    for pi, pg in enumerate(pages):
        nxt = pages[pi + 1][0][0] if pi + 1 < len(pages) else 1e9
        if t < nxt - 0.12:
            return pi
    return len(pages) - 1

def star(d, cx, cy, r, fill):
    pts = []
    for i in range(10):
        rad = r if i % 2 == 0 else r * 0.42
        a = -math.pi / 2 + i * math.pi / 5
        pts.append((cx + rad * math.cos(a), cy + rad * math.sin(a)))
    d.polygon(pts, fill=fill)

N_BARS = 46
BAR_W, BAR_GAP = 12, 8
WAVE_SPAN = N_BARS * (BAR_W + BAR_GAP) - BAR_GAP
WAVE_X0 = (W - WAVE_SPAN) // 2
TOTAL = int(DUR * FPS)
FADE = 10

def render(f):
    t = f / FPS
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)

    # lockup
    for i in range(5):
        star(d, W // 2 - 2 * 66 + i * 66, LOCKUP_Y, 26, GOLD)
    tw = measurer.textlength("FEEDBACK FRIDAY", font=title_font)
    d.text(((W - tw) / 2, LOCKUP_Y + 44), "FEEDBACK FRIDAY", font=title_font, fill=INK)
    bs = "H E E D   A I   S O L U T I O N S"
    bw = measurer.textlength(bs, font=sub_font)
    d.text(((W - bw) / 2, LOCKUP_Y + 130), bs, font=sub_font, fill=GOLD)

    # waveform: scrolling history, newest bar on the right
    for b in range(N_BARS):
        tb = t - (N_BARS - 1 - b) / FPS * 2
        a = env_at(tb)
        h = 10 + a * 150
        x = WAVE_X0 + b * (BAR_W + BAR_GAP)
        col = GOLD if b >= N_BARS - 3 else (
            int(GOLD[0] * 0.55 + BG[0] * 0.45), int(GOLD[1] * 0.55 + BG[1] * 0.45), int(GOLD[2] * 0.55 + BG[2] * 0.45))
        d.rounded_rectangle([x, WAVE_Y - h / 2, x + BAR_W, WAVE_Y + h / 2], radius=6, fill=col)

    # words with bouncing dot on the active word
    pi = page_at(t)
    pg = pages[pi]
    active = None
    for k, (s, e, w, li) in enumerate(pg):
        if s <= t:
            active = k
    line_words = {}
    for k, (s, e, w, li) in enumerate(pg):
        line_words.setdefault(li, []).append((k, w))
    for li, ws in line_words.items():
        total_w = sum(measurer.textlength(w + " ", font=word_font) for _, w in ws) - measurer.textlength(" ", font=word_font)
        x = (W - total_w) / 2
        y = TEXT_Y + li * 84
        for k, w in ws:
            wl = measurer.textlength(w, font=word_font)
            spoken = active is not None and k <= active
            d.text((x, y), w, font=word_font, fill=INK if spoken else DIM)
            if active is not None and k == active:
                bounce = abs(math.sin(t * 2 * math.pi * 2.2)) * 10
                d.ellipse([x + wl / 2 - 9, y - 34 - bounce, x + wl / 2 + 9, y - 16 - bounce], fill=GOLD)
            x += wl + measurer.textlength(" ", font=word_font)

    # attribution
    at = "MVP LAW  |  5-STAR REVIEW"
    aw = measurer.textlength(at, font=attr_font)
    d.text(((W - aw) / 2, ATTR_Y), at, font=attr_font, fill=GOLD)

    if f >= TOTAL - FADE:
        from PIL import ImageEnhance
        im = ImageEnhance.Brightness(im).enhance(max(0.0, (TOTAL - f) / FADE))
    return im

ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
proc = subprocess.Popen(
    [ffmpeg, "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
     "-i", "tts_src.wav", "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-pix_fmt", "yuv420p",
     "-crf", "18", "-preset", "medium", "-c:a", "aac", "-b:a", "160k",
     "-movflags", "+faststart", OUT],
    stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

previews = {int(2 * FPS): f"ag_{FORMAT}_a.jpg", int(DUR * 0.5 * FPS): f"ag_{FORMAT}_b.jpg", int((DUR - 2) * FPS): f"ag_{FORMAT}_c.jpg"}
for f in range(TOTAL):
    im = render(f)
    proc.stdin.write(im.tobytes())
    if f in previews:
        im.save(previews[f], quality=90)
proc.stdin.close()
proc.wait()
print(OUT, "frames:", TOTAL, "dur:", round(DUR, 1), "pages:", len(pages))
