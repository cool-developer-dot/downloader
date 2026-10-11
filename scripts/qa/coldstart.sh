#!/bin/bash
# Prints seconds from am start until the tab bar (browser chrome) is drawn. Run 3x, after a 5 s idle.
Q="$(cd "$(dirname "$0")" && pwd)"
S="${QA_WORK:-/tmp/vidorax-qa}"; mkdir -p "$S/shots" "$S/cold"
export ANDROID_SERIAL="${ANDROID_SERIAL:-emulator-5554}"
for run in 1 2 3; do
  adb shell am force-stop com.vidorax.fast.videodownloader; perl -e 'select(undef,undef,undef,5)'
  adb shell am start -n com.vidorax.fast.videodownloader/com.anonymous.vidorax.MainActivity >/dev/null
  T0=$(perl -MTime::HiRes=time -e 'print time')
  for i in $(seq 1 40); do
    adb exec-out screencap -p > $S/cold/x.png
    t=$(perl -MTime::HiRes=time -e "printf '%.1f', time-$T0")
    px=$(python3 -c "
from PIL import Image; im=Image.open('$S/cold/x.png').convert('RGB'); r,g,b=im.getpixel((135,2300)); print('chrome' if (r>150 and g<120) or (r<60 and g<60 and b<60 and False) else 'splash')")
    if [ "$px" = chrome ]; then echo "run $run: browser chrome at ${t}s"; break; fi
  done
done
