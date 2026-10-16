#!/usr/bin/env python3
"""
Builds the designed Google Play phone screenshots (1080x1920, 9:16) and the feature graphic (1024x500) for
VidoraX from raw device captures.

    python3 scripts/store/build_play_assets.py --raw <captures dir> --out ~/Downloads/VidoraX-Play-Assets/v2

<captures dir>/<lang>/<id>.png are 1080x2400 captures of the release build (ids and captions in captions.json);
the feature graphic uses <captures dir>/<lang>/02-video-available.png. Output: <out>/<lang>/<id>.png and
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
    args = parser.parse_args()

    config = json.loads((HERE / "captions.json").read_text(encoding="utf-8"))
    for font in (POPPINS_SEMIBOLD, POPPINS_BOLD):
        if not font.exists():
            sys.exit(f"missing {font} — run npm ci first")
    langs = args.lang or ["en", "ur"]
    raw_root = args.raw.expanduser().resolve()
    out_root = args.out.expanduser().resolve()
    with tempfile.TemporaryDirectory() as tmp:
        work = pathlib.Path(tmp)
        for lang in langs:
            for screen in config["screens"]:
                raw = raw_root / lang / f"{screen['id']}.png"
                if not raw.exists():
                    sys.exit(f"missing capture {raw}")
                out = out_root / lang / f"{screen['id']}.png"
                render(screenshot_html(raw, screen[lang], lang), SCREEN_W, SCREEN_H, out, work)
                print(out)
            feature = config["feature"][lang]
            raw = raw_root / lang / "02-video-available.png"
            out = out_root / lang / "feature-graphic-1024x500.png"
            render(feature_html(raw, feature["title"], feature["tagline"], lang), FEATURE_W, FEATURE_H, out, work)
            print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
