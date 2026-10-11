#!/bin/bash
Q="$(cd "$(dirname "$0")" && pwd)"
S="${QA_WORK:-/tmp/vidorax-qa}"; mkdir -p "$S/shots" "$S/cold"
export ANDROID_SERIAL="${ANDROID_SERIAL:-emulator-5554}"
w(){ perl -e "select(undef,undef,undef,$1)"; }
pin(){ for c in 1 3 5 7; do adb shell input text $c; w 0.4; done; }
sw(){ $Q/ui.py dump | grep -E "^9[0-9]{2},[0-9]+\s''\s'App Lock'" | head -1 | cut -f1; }
adb shell input keyevent 127; $Q/ui.py tap "=Close player" >/dev/null 2>&1
$Q/ui.py tap "=Settings tab" >/dev/null; w 2.5
for i in 1 2 3; do adb shell input swipe 540 1900 540 700 300; done; w 1.5
p=$(sw); adb shell input tap ${p%,*} ${p#*,}; w 3
adb shell input tap 540 775; w 1.5; pin; w 2; pin; w 3; adb shell input keyevent 111; w 3
$Q/ui.py tap "I've saved my recovery code" >/dev/null; w 1.5
$Q/ui.py tap "I understand" >/dev/null; w 1.5
$Q/ui.py tap "=Enable App Lock" >/dev/null; w 3
echo "enabled: $($Q/ui.py dump | grep -c 'Change PIN')"
adb shell input keyevent 3; w 4; adb shell am start -n com.vidorax.fast.videodownloader/com.anonymous.vidorax.MainActivity >/dev/null 2>&1; w 3
$Q/shot.sh r8_locked_$1 >/dev/null
python3 -c "
from PIL import Image; im=Image.open('$S/shots/r8_locked_$1.png').convert('RGB'); print('lock screen shown:', im.getpixel((225,500))[:3]==(255,255,255) and im.getpixel((225,95))[0]>240)"
pin; w 3; adb shell input keyevent 111; w 1.5
p=$(sw); adb shell input tap ${p%,*} ${p#*,}; w 3
adb shell input tap 540 712; w 1.5; pin; w 3
$Q/ui.py tap "=DISABLE" >/dev/null; w 3
adb shell input keyevent 3; w 3; adb shell am start -n com.vidorax.fast.videodownloader/com.anonymous.vidorax.MainActivity >/dev/null 2>&1; w 3
$Q/shot.sh r8_after_disable_$1 >/dev/null
echo "change-pin row after disable (0 = off): $($Q/ui.py dump | grep -c 'Change PIN')"
