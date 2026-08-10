import subprocess, math, bisect
from PIL import Image, ImageDraw, ImageFont, ImageEnhance
import imageio_ffmpeg

W, H = 1080, 1350
FPS = 24
MARGIN = 90
BG = (15, 15, 19)
INK = (240, 238, 232)
GOLD = (245, 179, 30)
GRAY = (155, 155, 162)

FDIR = "/usr/share/fonts/truetype/liberation/"
title_font = ImageFont.truetype(FDIR + "LiberationSans-Bold.ttf", 78)
attr_font = ImageFont.truetype(FDIR + "LiberationSans-Bold.ttf", 42)

TITLE = "FEEDBACK FRIDAY"
BODY = ('"So far we have had a great experience working with Mike. '
        'He provides a quick turnaround on every project, highly communicative '
        'throughout the process, and consistently brings creative ideas to the table. '
        'He has made it easy to build on each other\'s ideas, resulting in a final '
        'product that exceeds our expectations. We highly recommend them to anyone '
        'looking for an efficient, innovative, and responsive team."')
ATTR = "MVP Law  |  5-Star Review"

measurer = ImageDraw.Draw(Image.new("RGB", (10, 10)))

def wrap(text, font, width):
    lines, line = [], ""
    for word in text.split(" "):
        trial = word if not line else line + " " + word
        if measurer.textlength(trial, font=font) <= width:
            line = trial
        else:
            lines.append(line)
            line = word
    lines.append(line)
    return lines

body_size = 46
while True:
    body_font = ImageFont.truetype(FDIR + "LiberationSans-Regular.ttf", body_size)
    body_lines = wrap(BODY, body_font, W - 2 * MARGIN)
    line_h = int(body_size * 1.42)
    if 360 + len(body_lines) * line_h + 150 <= H - 140 or body_size <= 34:
        break
    body_size -= 2

# char reveal schedule for body: 2 chars/frame, pauses at punctuation
sched, t = [], 0.0
for ch in BODY:
    sched.append(t)
    t += 0.5
    if ch in ".!?":
        t += 9
    elif ch in ",;":
        t += 3

STARS_END = 26            # 5 stars pop in
TITLE_CHARS = len(TITLE)  # 1 char/frame
TITLE_END = STARS_END + TITLE_CHARS + 12
BODY_START = TITLE_END
BODY_FRAMES = int(t) + 8
ATTR_START = BODY_START + BODY_FRAMES
ATTR_END = ATTR_START + len(ATTR) + 10
HOLD_END = ATTR_END + 66
FADE = 10
TOTAL = HOLD_END + FADE

def star(draw, cx, cy, r, fill):
    pts = []
    for i in range(10):
        rad = r if i % 2 == 0 else r * 0.42
        a = -math.pi / 2 + i * math.pi / 5
        pts.append((cx + rad * math.cos(a), cy + rad * math.sin(a)))
    draw.polygon(pts, fill=fill)

def render(f):
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)

    # stars
    n_stars = min(5, f // 5 + 1)
    for i in range(n_stars):
        star(d, MARGIN + 34 + i * 84, 208, 34, GOLD)

    cursor = None  # (x, y, height)

    # title
    if f >= STARS_END:
        n = min(len(TITLE), f - STARS_END)
        shown = TITLE[:n]
        d.text((MARGIN, 292), shown, font=title_font, fill=INK)
        if f < BODY_START:
            cursor = (MARGIN + measurer.textlength(shown, font=title_font) + 10, 292 + 8, 72)

    # body
    body_y = 470
    if f >= BODY_START:
        n = bisect.bisect_right(sched, f - BODY_START)
        remaining = n
        last_x, last_y = MARGIN, body_y
        for li, line in enumerate(body_lines):
            if remaining <= 0:
                break
            seg = line[:remaining]
            y = body_y + li * line_h
            d.text((MARGIN, y), seg, font=body_font, fill=INK)
            last_x = MARGIN + measurer.textlength(seg, font=body_font) + 8
            last_y = y
            remaining -= len(line) + 1  # +1 for the space consumed at wrap
        if f < ATTR_START:
            cursor = (last_x, last_y + 4, int(body_size * 1.1))

    # attribution
    if f >= ATTR_START:
        n = min(len(ATTR), f - ATTR_START)
        shown = ATTR[:n]
        ay = body_y + len(body_lines) * line_h + 52
        d.text((MARGIN, ay), shown, font=attr_font, fill=GOLD)
        cursor = (MARGIN + measurer.textlength(shown, font=attr_font) + 10, ay + 2, 46)

    # cursor: solid while typing, blink while holding
    typing = (STARS_END <= f < STARS_END + TITLE_CHARS) or \
             (BODY_START <= f < ATTR_START - 8) or (ATTR_START <= f < ATTR_START + len(ATTR))
    if cursor and (typing or (f // 9) % 2 == 0):
        x, y, h = cursor
        d.rectangle([x, y, x + 22, y + h], fill=GOLD)

    if f >= HOLD_END:
        im = ImageEnhance.Brightness(im).enhance(max(0.0, 1 - (f - HOLD_END + 1) / FADE))
    return im

ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
out = "feedback_friday_typing.mp4"
proc = subprocess.Popen(
    [ffmpeg, "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
     "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p",
     "-crf", "18", "-preset", "medium", "-movflags", "+faststart", out],
    stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

previews = {60: "prev_early.jpg", ATTR_START - 20: "prev_mid.jpg", ATTR_END + 20: "prev_end.jpg"}
for f in range(TOTAL):
    im = render(f)
    proc.stdin.write(im.tobytes())
    if f in previews:
        im.save(previews[f], quality=92)
proc.stdin.close()
proc.wait()
print("frames:", TOTAL, "duration_s:", round(TOTAL / FPS, 1), "lines:", len(body_lines), "font:", body_size)
