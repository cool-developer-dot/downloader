#!/bin/bash
# Fresh test1 install + R10 data: 1 favorited MP4, history pages, recent search "cats".
Q="$(cd "$(dirname "$0")" && pwd)"
S="${QA_WORK:-/tmp/vidorax-qa}"; mkdir -p "$S/shots" "$S/cold"
export ANDROID_SERIAL="${ANDROID_SERIAL:-emulator-5554}"
w(){ perl -e "select(undef,undef,undef,$1)"; }
adb uninstall com.vidorax.fast.videodownloader >/dev/null
adb install ${SEED_APK:?set SEED_APK to the test1 APK} | tail -1
adb shell monkey -p com.vidorax.fast.videodownloader -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; w 30
adb shell input tap 96 2256; w 5
adb shell "am start -a android.intent.action.VIEW -d 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4' com.vidorax.fast.videodownloader" >/dev/null 2>&1; w 20
adb shell input tap 1010 2004; w 4
$Q/ui.py tap "Don’t allow" >/dev/null 2>&1; w 8
adb shell input tap 405 2274; w 3
echo "downloads: $($Q/ui.py dump | grep -oE "'[^']*Completed\.[^']*'" | head -2 | tr '\n' ' ')"
adb shell input tap 587 829; w 3
$Q/ui.py tap "Add to favorites"; w 2
adb shell input keyevent 4; w 2
adb shell input tap 135 2274; w 3
adb shell "am start -a android.intent.action.VIEW -d 'https://example.com/' com.vidorax.fast.videodownloader" >/dev/null 2>&1; w 8
adb shell "am start -a android.intent.action.VIEW -d 'https://www.wikipedia.org/' com.vidorax.fast.videodownloader" >/dev/null 2>&1; w 8
adb shell input tap 540 221; w 2.5
$Q/ui.py tap "Clear address" >/dev/null 2>&1; w 1.5
for c in c a t s; do adb shell input text $c; w 0.4; done; w 2
$Q/ui.py tap "Search Google for “cats”"; w 6
adb shell input keyevent 3; w 2
echo seeded
