#!/bin/bash
Q="$(cd "$(dirname "$0")" && pwd)"
S="${QA_WORK:-/tmp/vidorax-qa}"; mkdir -p "$S/shots" "$S/cold"
export ANDROID_SERIAL="${ANDROID_SERIAL:-emulator-5554}"
mkdir -p $S/shots
rm -f $S/shots/$1.full.png
adb -s "$ANDROID_SERIAL" emu screenrecord screenshot $S/shots/$1.full.png >/dev/null 2>&1
if [ ! -s $S/shots/$1.full.png ]; then adb -s "$ANDROID_SERIAL" exec-out screencap -p > $S/shots/$1.full.png; fi
sips -Z 1000 $S/shots/$1.full.png --out $S/shots/$1.png >/dev/null 2>&1
echo $S/shots/$1.png
