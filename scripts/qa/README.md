# QA helpers for the Pixel_8 emulator

Made during Prompt A (Faran · Sonnet, 2026-10-10) and kept for the next prompts. They drive the release build on the
`Pixel_8` AVD (API 35, 1080×2400) with `adb`; several taps are screen coordinates, so other devices need adjusting.
Screenshots and results go to `$QA_WORK` (default `/tmp/vidorax-qa`). Set `ANDROID_SERIAL` if the emulator isn't
`emulator-5554`. Needs Python 3 with Pillow (`pip3 install pillow`).

| Script | What it does |
| --- | --- |
| `seed_test1.sh` | Uninstalls the app, installs the `v1.0.0-test1` APK given in `SEED_APK`, and creates the R10 data: one favourited MP4 download, two history pages, the recent search "cats" |
| `regress.py <tag> [steps]` | Runs the regression smoke (R1–R10; default order `r10 r1 r2 r3 r7 r5 r8 r9 r4`), prints one line per check and writes `regress_<tag>.txt`. `CHECK` = a person must confirm it from the screenshot (R5's toast) — never report it as PASS unseen |
| `r8.sh <tag>` | App Lock on → background → PIN screen shown → App Lock off (PIN 1357). More reliable than the scripted R8 |
| `coldstart.sh` | Three cold starts; seconds until the browser chrome is drawn (test1 baseline 6.2–6.4 s: branded splash, by design) |
| `ui.py dump` / `ui.py tap "<text>"` | Lists the screen's labels with tap points / taps the first match (`=` prefix = exact) |
| `shot.sh <name>` | Full-resolution screenshot (`emu screenrecord screenshot`, falls back to `screencap`) |

Typical release pass:

```bash
SEED_APK=/path/to/test1-release.apk bash scripts/qa/seed_test1.sh
adb install -r /path/to/task-release.apk
python3 scripts/qa/regress.py F1
```

Known limits: `uiautomator dump` hangs while a page video plays (use screenshots); the AVD keyboard sometimes floats
over buttons (submit with Enter, keyevent 66); the emulator can't produce a two-finger pinch.
