#!/usr/bin/env python3
"""
Builds the designed Google Play phone screenshots (1080x1920, 9:16) and the feature graphic (1024x500) for
VidoraX from raw device captures.

    python3 scripts/store/build_play_assets.py --raw <captures dir> --out ~/Downloads/VidoraX-Play-Assets/v3-pro
    python3 scripts/store/build_play_assets.py --style classic --raw <captures dir> --out ~/Downloads/VidoraX-Play-Assets/v2

<captures dir>/<lang>/<id>.png are 1080x2400 captures of the release build. Styles: "pro" (default; headline with a
highlighted word, subtitle, realistic phone frame, a feature badge; copy in captions_pro.json) and "classic" (one
caption line; captions.json). The feature graphic uses 02-video-available.png (and 05-library.png in "pro"). Output: <out>/<lang>/<id>.png and
<out>/<lang>/feature-graphic-1024x500.png, 24-bit RGB PNG (no alpha).

Each asset is laid out as HTML and rendered by headless Google Chrome, which shapes Urdu correctly (Pillow here has
no libraqm). Captions use Poppins from node_modules; Urdu falls back to the system's Geeza Pro (macOS).
Needs: Google Chrome, Python 3 with Pillow, `npm ci` done (for the Poppins files).
"""

import argparse
import html
import json
import pathlib
import subprocess
import sys
import tempfile

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
HERE = pathlib.Path(__file__).resolve().parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
POPPINS_SEMIBOLD = ROOT / "node_modules/@expo-google-fonts/poppins/600SemiBold/Poppins_600SemiBold.ttf"
POPPINS_BOLD = ROOT / "node_modules/@expo-google-fonts/poppins/700Bold/Poppins_700Bold.ttf"
POPPINS_MEDIUM = ROOT / "node_modules/@expo-google-fonts/poppins/500Medium/Poppins_500Medium.ttf"
ICON_DIR = ROOT / "node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons"
ICON_FONT = ICON_DIR / "Fonts/MaterialCommunityIcons.ttf"
ICON_GLYPHS = ICON_DIR / "glyphmaps/MaterialCommunityIcons.json"
LOGO = ROOT / "assets/logos/vidorax-logo.png"

# Brand red from src/theme/colors.ts (brandRed / brandRedPressed).
BRAND_RED = "#DC3C2C"
BRAND_RED_DARK = "#C43426"

SCREEN_W, SCREEN_H = 1080, 1920
FEATURE_W, FEATURE_H = 1024, 500


def fonts_css() -> str:
    return f"""
@font-face {{ font-family: 'Poppins'; font-weight: 600; src: url('{POPPINS_SEMIBOLD.as_uri()}'); }}
@font-face {{ font-family: 'Poppins'; font-weight: 700; src: url('{POPPINS_BOLD.as_uri()}'); }}
@font-face {{ font-family: 'Poppins'; font-weight: 500; src: url('{POPPINS_MEDIUM.as_uri()}'); }}
@font-face {{ font-family: 'MDI'; src: url('{ICON_FONT.as_uri()}'); }}
"""


def page(body: str, width: int, height: int, lang: str) -> str:
    rtl = lang == "ur"
    return f"""<!doctype html>
<html lang="{lang}" dir="{'rtl' if rtl else 'ltr'}"><head><meta charset="utf-8"><style>
{fonts_css()}
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
html, body {{ width: {width}px; height: {height}px; overflow: hidden; }}
body {{
  background:
    radial-gradient(circle at 85% 8%, rgba(255,255,255,0.16) 0, rgba(255,255,255,0) 38%),
    radial-gradient(circle at 10% 95%, rgba(0,0,0,0.16) 0, rgba(0,0,0,0) 45%),
    linear-gradient(165deg, {BRAND_RED} 0%, {BRAND_RED} 55%, {BRAND_RED_DARK} 100%);
  color: #fff;
  font-family: 'Poppins', 'Geeza Pro', sans-serif;
  font-weight: 600;
}}
.urdu {{ font-family: 'Geeza Pro', 'Poppins', sans-serif; font-weight: 700; }}
.balance {{ text-wrap: balance; }}
.phone {{
  position: absolute; background: #111; border-radius: 64px; padding: 14px;
  box-shadow: 0 40px 80px rgba(0,0,0,0.35), 0 0 0 2px rgba(255,255,255,0.12);
}}
.phone img {{ display: block; border-radius: 50px; }}
</style></head><body>{body}</body></html>"""


def screenshot_html(raw: pathlib.Path, caption: str, lang: str) -> str:
    # Phone: the whole 1080x2400 capture, scaled to fit under the caption.
    inner_h = 1440
    inner_w = round(inner_h * 1080 / 2400)
    left = (SCREEN_W - (inner_w + 28)) // 2
    cls = "urdu" if lang == "ur" else ""
    size = 74 if lang == "ur" else 78
    line = 1.45 if lang == "ur" else 1.15
    return page(
        f"""
<div class="{cls} balance" style="position:absolute; top:0; left:60px; right:60px; height:420px; display:flex;
  align-items:center; justify-content:center; text-align:center; font-size:{size}px; line-height:{line};
  letter-spacing:{'0' if lang == 'ur' else '-0.5px'};">{html.escape(caption)}</div>
<div class="phone" style="top:432px; left:{left}px;">
  <img src="{raw.as_uri()}" width="{inner_w}" height="{inner_h}">
</div>""",
        SCREEN_W,
        SCREEN_H,
        lang,
    )


def feature_html(raw: pathlib.Path, title: str, tagline: str, lang: str) -> str:
    inner_w = 300
    inner_h = round(inner_w * 2400 / 1080)
    rtl = lang == "ur"
    text_side = "right" if rtl else "left"
    phone_side = "left" if rtl else "right"
    tag_cls = "urdu" if rtl else ""
    tag_size = 40 if rtl else 42
    return page(
        f"""
<div style="position:absolute; top:0; bottom:0; {text_side}:72px; width:560px; display:flex; flex-direction:column;
  justify-content:center; gap:18px; text-align:{'right' if rtl else 'left'};">
  <div style="display:flex; align-items:center; gap:22px; justify-content:flex-start;">
    <img src="{LOGO.as_uri()}" width="112" height="112" style="border-radius:26px;
      box-shadow:0 12px 28px rgba(0,0,0,0.25); background:#fff;">
    <div style="font-family:'Poppins'; font-weight:700; font-size:76px; line-height:1;" dir="ltr">{html.escape(title)}</div>
  </div>
  <div class="{tag_cls} balance" style="font-size:{tag_size}px; line-height:{1.5 if rtl else 1.2}; opacity:0.96;">{html.escape(tagline)}</div>
</div>
<div class="phone" style="top:56px; {phone_side}:84px; border-radius:46px; padding:10px;">
  <img src="{raw.as_uri()}" width="{inner_w}" height="{inner_h}" style="border-radius:36px;">
</div>""",
        FEATURE_W,
        FEATURE_H,
        lang,
    )


# ----------------------------------------------------------------------------------------------- "pro" style
# Brand reds from src/theme/colors.ts plus a lighter top tone for depth.
PRO_TOP = "#EF4B39"
PRO_DEEP = "#A8281C"


def icon(name: str, glyphs: dict) -> str:
    code = glyphs.get(name)
    return f"&#{code};" if code else ""


def highlighted(text: str, word: str) -> str:
    escaped = html.escape(text)
    mark = html.escape(word or "")
    if mark and mark in escaped:
        return escaped.replace(mark, f'<span class="hl">{mark}</span>', 1)
    return escaped


def pro_page(body: str, width: int, height: int, lang: str) -> str:
    rtl = lang == "ur"
    return f"""<!doctype html>
<html lang="{lang}" dir="{'rtl' if rtl else 'ltr'}"><head><meta charset="utf-8"><style>
{fonts_css()}
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
html, body {{ width: {width}px; height: {height}px; overflow: hidden; }}
body {{
  position: relative;
  background:
    radial-gradient(120% 60% at 50% -5%, rgba(255,255,255,0.28) 0, rgba(255,255,255,0) 55%),
    radial-gradient(70% 45% at 100% 100%, rgba(0,0,0,0.28) 0, rgba(0,0,0,0) 70%),
    linear-gradient(165deg, {PRO_TOP} 0%, {BRAND_RED} 42%, {BRAND_RED_DARK} 70%, {PRO_DEEP} 100%);
  color: #fff;
  font-family: 'Poppins', 'Geeza Pro', sans-serif;
}}
.dots {{
  position: absolute; inset: 0; pointer-events: none;
  background-image: radial-gradient(rgba(255,255,255,0.13) 1.6px, transparent 1.8px);
  background-size: 34px 34px;
  -webkit-mask-image: linear-gradient(180deg, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.15) 45%, rgba(0,0,0,0) 70%);
}}
.ring {{ position: absolute; border-radius: 50%; border: 2px solid rgba(255,255,255,0.10); pointer-events: none; }}
.glow {{ position: absolute; border-radius: 50%; pointer-events: none;
  background: radial-gradient(circle, rgba(255,255,255,0.30) 0, rgba(255,255,255,0) 65%); }}
.urdu {{ font-family: 'Geeza Pro', 'Poppins', sans-serif; font-weight: 700; }}
.balance {{ text-wrap: balance; }}
.chip {{ display: inline-flex; align-items: center; gap: 14px; padding: 9px 24px 9px 10px; border-radius: 999px;
  background: rgba(255,255,255,0.16); border: 1.5px solid rgba(255,255,255,0.32);
  font-weight: 600; font-size: 30px; letter-spacing: 0.2px; }}
.chip img {{ width: 46px; height: 46px; border-radius: 13px; background: #fff; }}
.hl {{ background: linear-gradient(180deg, transparent 58%, rgba(255,226,170,0.55) 58%, rgba(255,226,170,0.55) 90%, transparent 90%);
  padding: 0 4px; border-radius: 6px; }}
.phone {{
  position: absolute; padding: 15px; border-radius: 76px;
  background: linear-gradient(145deg, #3a3a40 0%, #121214 22%, #0b0b0d 60%, #2a2a2f 100%);
  box-shadow: 0 0 0 2.5px rgba(255,255,255,0.10), inset 0 0 0 2px rgba(255,255,255,0.06),
    0 70px 120px rgba(60,0,0,0.55), 0 24px 48px rgba(0,0,0,0.35);
}}
.phone img {{ display: block; border-radius: 61px; }}
.phone .gloss {{ position: absolute; inset: 15px; border-radius: 61px; pointer-events: none;
  background: linear-gradient(125deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0) 28%); }}
.phone .btn {{ position: absolute; width: 6px; border-radius: 3px; background: linear-gradient(90deg,#2b2b30,#55555c); }}
.badge {{ position: absolute; display: flex; align-items: center; gap: 18px; padding: 18px 30px 18px 18px;
  border-radius: 30px; background: rgba(255,255,255,0.97); color: #1A1A1A;
  box-shadow: 0 24px 50px rgba(40,0,0,0.35), 0 4px 10px rgba(0,0,0,0.12); white-space: nowrap; }}
.badge .ic {{ width: 64px; height: 64px; border-radius: 20px; display: flex; align-items: center; justify-content: center;
  background: linear-gradient(145deg, {PRO_TOP}, {BRAND_RED_DARK}); color: #fff; font-family: 'MDI'; font-size: 38px; }}
.badge .tx {{ font-weight: 600; font-size: 32px; }}
.pill {{ display: inline-flex; align-items: center; gap: 8px; padding: 7px 16px; border-radius: 999px;
  background: rgba(255,255,255,0.16); border: 1.5px solid rgba(255,255,255,0.30); font-weight: 600; font-size: 20px; }}
.pill .ic {{ font-family: 'MDI'; font-size: 22px; }}
</style></head><body><div class="dots"></div>{body}</body></html>"""


def phone_html(raw: pathlib.Path, left: int, top: int, inner_w: int, inner_h: int, extra_style: str = "") -> str:
    return f"""<div class="phone" style="left:{left}px; top:{top}px; {extra_style}">
  <img src="{raw.as_uri()}" width="{inner_w}" height="{inner_h}">
  <div class="gloss"></div>
  <div class="btn" style="right:-6px; top:{round(inner_h * 0.20)}px; height:{round(inner_h * 0.09)}px;"></div>
  <div class="btn" style="right:-6px; top:{round(inner_h * 0.33)}px; height:{round(inner_h * 0.15)}px;"></div>
</div>"""


def pro_screenshot_html(raw: pathlib.Path, copy: dict, index: int, lang: str, glyphs: dict, badge_at=None) -> str:
    rtl = lang == "ur"
    inner_h = 1268
    inner_w = round(inner_h * 1080 / 2400)
    frame = 15
    phone_w = inner_w + 2 * frame
    phone_left = (SCREEN_W - phone_w) // 2
    phone_top = 590
    # The badge alternates sides from screen to screen, overlapping the phone's edge.
    on_left = (index % 2 == 0) != rtl
    # badgeAt (captions_pro.json) moves a badge off UI it would hide; it is a fraction of the screen height.
    at = badge_at if badge_at is not None else (0.62 if index % 2 == 0 else 0.38)
    badge_top = phone_top + round(inner_h * at)
    side = (f"left:{phone_left - 70}px;" if on_left else f"right:{SCREEN_W - (phone_left + phone_w) - 70}px;")
    head_cls = "urdu" if rtl else ""
    head_size = 80 if rtl else 86
    head_line = 1.42 if rtl else 1.06
    sub_cls = "urdu" if rtl else ""
    sub_font = "font-weight:700; font-size:34px; line-height:1.6;" if rtl else "font-weight:500; font-size:35px; line-height:1.35;"
    badge = copy["badge"]
    return pro_page(
        f"""
<div class="glow" style="width:1100px; height:1100px; left:-10px; top:520px;"></div>
<div class="ring" style="width:1300px; height:1300px; left:-110px; top:470px;"></div>
<div class="ring" style="width:1700px; height:1700px; left:-310px; top:270px;"></div>
<div style="position:absolute; top:40px; height:{phone_top - 70}px; left:70px; right:70px; display:flex; flex-direction:column;
  align-items:center; justify-content:center; gap:24px; text-align:center;">
  <div class="chip" dir="ltr"><img src="{LOGO.as_uri()}">VidoraX</div>
  <div class="{head_cls} balance" style="font-weight:700; font-size:{head_size}px; line-height:{head_line};
    letter-spacing:{'0' if rtl else '-1.2px'}; text-shadow:0 4px 18px rgba(80,0,0,0.25);">{highlighted(copy['headline'], copy.get('highlight', ''))}</div>
  <div class="{sub_cls} balance" style="{sub_font} opacity:0.9; max-width:860px;">{html.escape(copy['subtitle'])}</div>
</div>
{phone_html(raw, phone_left, phone_top, inner_w, inner_h)}
<div class="badge" style="top:{badge_top}px; {side}">
  <div class="ic">{icon(badge['icon'], glyphs)}</div><div class="tx {'urdu' if rtl else ''}">{html.escape(badge['text'])}</div>
</div>""",
        SCREEN_W,
        SCREEN_H,
        lang,
    )


def pro_feature_html(front: pathlib.Path, back: pathlib.Path, copy: dict, lang: str, glyphs: dict) -> str:
    rtl = lang == "ur"
    text_side = "right" if rtl else "left"
    inner_w = 214
    inner_h = round(inner_w * 2400 / 1080)
    pill_icons = ["high-definition", "play-circle", "shield-lock"]
    pills = "".join(
        f'<span class="pill {"urdu" if rtl else ""}"><span class="ic">{icon(i, glyphs)}</span>{html.escape(t)}</span>'
        for i, t in zip(pill_icons, copy["pills"])
    )
    # Two phones on the side opposite the text, tilted towards each other, cut by the bottom edge.
    if rtl:
        back_pos, front_pos = (40, 74), (196, 44)
        back_rot, front_rot = 7, -6
    else:
        back_pos, front_pos = (FEATURE_W - 40 - inner_w - 18, 74), (FEATURE_W - 196 - inner_w - 18, 44)
        back_rot, front_rot = -7, 6
    return pro_page(
        f"""
<div class="glow" style="width:700px; height:700px; {'left' if rtl else 'right'}:-120px; top:-140px;"></div>
<div class="ring" style="width:620px; height:620px; {'left' if rtl else 'right'}:-80px; top:-60px;"></div>
{phone_html(back, back_pos[0], back_pos[1], inner_w, inner_h, f"transform:rotate({back_rot}deg) scale(0.92); padding:9px; border-radius:42px; opacity:0.96;")}
{phone_html(front, front_pos[0], front_pos[1], inner_w, inner_h, f"transform:rotate({front_rot}deg); padding:9px; border-radius:42px;")}
<div style="position:absolute; top:0; bottom:0; {text_side}:60px; width:470px; display:flex; flex-direction:column;
  justify-content:center; gap:16px; text-align:{'right' if rtl else 'left'};">
  <div style="display:flex; align-items:center; gap:20px;">
    <img src="{LOGO.as_uri()}" width="100" height="100" style="border-radius:24px; background:#fff;
      box-shadow:0 14px 30px rgba(60,0,0,0.35);">
    <div style="font-weight:700; font-size:70px; line-height:1; letter-spacing:-1px;" dir="ltr">{html.escape(copy['title'])}</div>
  </div>
  <div class="{'urdu' if rtl else ''} balance" style="font-weight:{700 if rtl else 600}; font-size:{36 if rtl else 38}px;
    line-height:{1.5 if rtl else 1.2};">{html.escape(copy['tagline'])}</div>
  <div style="display:flex; flex-wrap:wrap; gap:10px; margin-top:4px;">{pills}</div>
</div>""",
        FEATURE_W,
        FEATURE_H,
        lang,
    )


def render(html_text: str, width: int, height: int, out: pathlib.Path, work: pathlib.Path) -> None:
    src = work / (out.stem + ".html")
    src.write_text(html_text, encoding="utf-8")
    shot = work / (out.stem + ".chrome.png")
    command = [
        CHROME,
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--no-first-run",
        "--allow-file-access-from-files",
        "--force-device-scale-factor=1",
        f"--user-data-dir={work / ('profile-' + out.stem)}",
        f"--window-size={width},{height}",
        "--virtual-time-budget=3000",
        f"--screenshot={shot}",
        src.as_uri(),
    ]
    # Headless Chrome now and then exits early on a busy machine: one retry with a fresh profile.
    for attempt in range(2):
        result = subprocess.run(command, capture_output=True)
        if result.returncode == 0 and shot.exists():
            break
        if attempt == 1:
            sys.exit(f"Chrome failed for {out.name}: {result.stderr.decode(errors='replace')[-400:]}")
    image = Image.open(shot)
    if image.size != (width, height):
        image = image.crop((0, 0, width, height))
    out.parent.mkdir(parents=True, exist_ok=True)
    image.convert("RGB").save(out, "PNG", optimize=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    parser.add_argument("--raw", required=True, type=pathlib.Path, help="captures: <raw>/<lang>/<id>.png")
    parser.add_argument("--out", required=True, type=pathlib.Path)
    parser.add_argument("--lang", choices=["en", "ur"], action="append", help="default: both")
    parser.add_argument("--style", choices=["pro", "classic"], default="pro")
    args = parser.parse_args()

    pro_style = args.style == "pro"
    config = json.loads((HERE / ("captions_pro.json" if pro_style else "captions.json")).read_text(encoding="utf-8"))
    glyphs = json.loads(ICON_GLYPHS.read_text(encoding="utf-8")) if pro_style else {}
    for font in (POPPINS_SEMIBOLD, POPPINS_BOLD, POPPINS_MEDIUM, ICON_FONT):
        if not font.exists():
            sys.exit(f"missing {font} — run npm ci first")
    langs = args.lang or ["en", "ur"]
    raw_root = args.raw.expanduser().resolve()
    out_root = args.out.expanduser().resolve()
    with tempfile.TemporaryDirectory() as tmp:
        work = pathlib.Path(tmp)
        for lang in langs:
            for index, screen in enumerate(config["screens"]):
                raw = raw_root / lang / f"{screen['id']}.png"
                if not raw.exists():
                    sys.exit(f"missing capture {raw}")
                out = out_root / lang / f"{screen['id']}.png"
                if pro_style:
                    page_html = pro_screenshot_html(raw, screen[lang], index, lang, glyphs, screen.get("badgeAt"))
                else:
                    page_html = screenshot_html(raw, screen[lang], lang)
                render(page_html, SCREEN_W, SCREEN_H, out, work)
                print(out)
            feature = config["feature"][lang]
            raw = raw_root / lang / "02-video-available.png"
            out = out_root / lang / "feature-graphic-1024x500.png"
            if pro_style:
                page_html = pro_feature_html(raw, raw_root / lang / "05-library.png", feature, lang, glyphs)
            else:
                page_html = feature_html(raw, feature["title"], feature["tagline"], lang)
            render(page_html, FEATURE_W, FEATURE_H, out, work)
            print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
