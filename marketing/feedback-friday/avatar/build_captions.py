import json, re, difflib

words = json.load(open("words.json"))  # [[start, end, word], ...]
script = open("script.txt").read().split()

norm = lambda t: re.sub(r"[^a-z0-9]", "", t.lower())
a = [norm(w[2]) for w in words]
b = [norm(t) for t in script]

# map script tokens to whisper timings; whisper-only tokens are dropped
timed = []  # (start, end, script_word)
sm = difflib.SequenceMatcher(a=a, b=b, autojunk=False)
for tag, i1, i2, j1, j2 in sm.get_opcodes():
    if tag == "equal":
        for k in range(i2 - i1):
            timed.append((words[i1 + k][0], words[i1 + k][1], script[j1 + k]))
    elif tag == "replace":
        span_start, span_end = words[i1][0], words[i2 - 1][1]
        n = j2 - j1
        for k in range(n):
            s = span_start + (span_end - span_start) * k / n
            e = span_start + (span_end - span_start) * (k + 1) / n
            timed.append((s, e, script[j1 + k]))
    elif tag == "insert":  # script words whisper never heard: pin at boundary
        anchor = words[i1 - 1][1] if i1 > 0 else 0.0
        for k in range(j2 - j1):
            timed.append((anchor, anchor + 0.05, script[j1 + k]))

timed.sort(key=lambda t: t[0])

clean = lambda w: re.sub(r'[",.:;!?’‘“”]|\'(?!\w)|(?<!\w)\'', "", w)

# group into 1-2 word pop captions (pair <=11 chars, join gap <0.35s)
segs = []
i = 0
while i < len(timed):
    s, e, w = timed[i]
    text = clean(w)
    if i + 1 < len(timed):
        s2, e2, w2 = timed[i + 1]
        if s2 - e < 0.35 and len(text) + 1 + len(clean(w2)) <= 11:
            e, text = e2, text + " " + clean(w2)
            i += 1
    segs.append([s, e + 0.15, text.upper()])  # 0.15s tail
    i += 1

for k, seg in enumerate(segs):  # min hold + de-overlap
    if seg[1] - seg[0] < 0.20:
        seg[1] = seg[0] + 0.20
    if k + 1 < len(segs) and seg[1] > segs[k + 1][0]:
        seg[1] = segs[k + 1][0]

DUR = 25.19
def ts(t):
    t = max(0.0, min(t, DUR))
    h = int(t // 3600); m = int(t % 3600 // 60); s = t % 60
    return f"{h}:{m:02d}:{s:05.2f}"

GOLD = "&H001EB3F5"
WHITE = "&H00FFFFFF"
BLACK = "&H00000000"

ass = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Liberation Sans,64,{WHITE},{WHITE},{BLACK},{BLACK},-1,0,0,0,100,100,1,0,1,5,0,2,40,40,288,1
Style: Stars,DejaVu Sans,46,{GOLD},{GOLD},{BLACK},{BLACK},0,0,0,0,100,100,6,0,1,3,0,8,40,40,118,1
Style: BrandTitle,Liberation Sans,54,{WHITE},{WHITE},{BLACK},{BLACK},-1,0,0,0,100,100,3,0,1,4,0,8,40,40,176,1
Style: BrandSub,Liberation Sans,33,{GOLD},{GOLD},{BLACK},{BLACK},-1,0,0,0,100,100,6,0,1,3,0,8,40,40,246,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,{ts(0)},{ts(DUR)},Stars,,0,0,0,,★★★★★
Dialogue: 0,{ts(0)},{ts(DUR)},BrandTitle,,0,0,0,,FEEDBACK FRIDAY
Dialogue: 0,{ts(0)},{ts(DUR)},BrandSub,,0,0,0,,HEED AI SOLUTIONS
"""
for s, e, text in segs:
    ass += f"Dialogue: 1,{ts(s)},{ts(e)},Cap,,0,0,0,,{text}\n"

open("captions.ass", "w", encoding="utf-8").write(ass)
print(len(segs), "caption segments; first:", segs[:3], "last:", segs[-2:])
