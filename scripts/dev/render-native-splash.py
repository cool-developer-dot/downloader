# Run from the repo root: python3 scripts/dev/render-native-splash.py [preview-prefix]
# Renders android/app/src/main/res/drawable[-night]-*/splashscreen_logo.png: the transparent VidoraX logo (112 dp plate)
# with the "VidoraX" wordmark underneath (Poppins SemiBold), centred on the 288 dp Android 12 splash-icon canvas and
# kept inside its 192 dp mask circle. Two themes, matching the in-app splash (src/theme/intro-palette.ts): light
# (#171717 wordmark on colors.xml splashscreen_background #FFFFFF) and night (#F5F5F5 on values-night #0D0D0D).
import os
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont
FONT = 'node_modules/@expo-google-fonts/poppins/600SemiBold/Poppins_600SemiBold.ttf'
logo = Image.open('assets/logos/vidorax-logo.png').convert('RGBA')   # 512 px plate on a 544 canvas
CANVAS_DP, PLATE_DP, GAP_DP, FONT_DP, TRACK_DP = 288, 112, 14, 26, 0.6
TEXT = 'VidoraX'
THEMES = [('', (0x17, 0x17, 0x17, 255), (255, 255, 255, 255)), ('-night', (0xF5, 0xF5, 0xF5, 255), (13, 13, 13, 255))]
preview = sys.argv[1] if len(sys.argv) > 1 else None
for (qualifier, COLOR, BACKGROUND), (name, s) in [(t, d) for t in THEMES for d in [('mdpi', 1), ('hdpi', 1.5), ('xhdpi', 2), ('xxhdpi', 3), ('xxxhdpi', 4)]]:
    W = int(CANVAS_DP * s)
    ss = 4
    font = ImageFont.truetype(FONT, int(round(FONT_DP * s * ss)))
    widths = [font.getlength(c) for c in TEXT]
    track = TRACK_DP * s * ss
    asc, desc = font.getmetrics()
    tmp = Image.new('RGBA', (int(sum(widths) + track * (len(TEXT) - 1)) + 4 * ss, asc + desc), (0, 0, 0, 0))
    d = ImageDraw.Draw(tmp)
    x = 0
    for c, wc in zip(TEXT, widths):
        d.text((x, 0), c, font=font, fill=COLOR)
        x += wc + track
    tmp = tmp.crop(tmp.getchannel('A').getbbox())
    word = tmp.convert('RGBa').resize((round(tmp.width / ss), round(tmp.height / ss)), Image.LANCZOS).convert('RGBA')
    logo_px, plate_px, gap = round(PLATE_DP * s * logo.width / 512), round(PLATE_DP * s), round(GAP_DP * s)
    scaled = logo.convert('RGBa').resize((logo_px, logo_px), Image.LANCZOS).convert('RGBA')
    top = (W - (plate_px + gap + word.height)) // 2
    out = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    out.paste(scaled, ((W - logo_px) // 2, top - (logo_px - plate_px) // 2), scaled)
    out.paste(word, ((W - word.width) // 2, top + plate_px + gap), word)
    folder = f'android/app/src/main/res/drawable{qualifier}-{name}'
    os.makedirs(folder, exist_ok=True)
    out.save(f'{folder}/splashscreen_logo.png', optimize=True)
    if name == 'xxxhdpi':  # app.json expo-splash-screen image / dark.image (kept in step; this project is never prebuilt)
        out.save(f'assets/logos/splash-icon{"-dark" if qualifier else ""}.png', optimize=True)
    a = np.array(out.getchannel('A'))
    ys, xs = np.nonzero(a > 8)
    r = np.sqrt((xs - (W - 1) / 2) ** 2 + (ys - (W - 1) / 2) ** 2).max() / s
    print(qualifier or 'day', name, W, 'max radius', round(float(r), 1), 'dp (mask 96)')
    if preview and name == 'xxxhdpi':
        bg = Image.new('RGBA', (W, W), BACKGROUND)
        bg.alpha_composite(out)
        bg.convert('RGB').save(f'{preview}{qualifier or "-day"}.png')
