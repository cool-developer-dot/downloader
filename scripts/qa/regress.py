#!/usr/bin/env python3
"""Regression smoke R1-R10 on the Pixel_8 AVD (release build installed over seeded test1).

usage: regress.py <tag> [steps...]   steps default: r10 r1 r2 r3 r7 r5 r8 r9 r4
Prints one line per check; screenshots go to shots/<tag>_<step>.png.
"""
import re
import subprocess
import sys
import time
import os
import xml.etree.ElementTree as ET

S = os.environ.get('QA_WORK', '/tmp/vidorax-qa')  # screenshots, results
Q = os.path.dirname(os.path.abspath(__file__))  # helper scripts
os.makedirs(f'{S}/shots', exist_ok=True)
A = ['adb', '-s', os.environ.get('ANDROID_SERIAL', 'emulator-5554')]
PKG = 'com.vidorax.fast.videodownloader'
TAG = sys.argv[1]
STEPS = sys.argv[2:] or ['r10', 'r1', 'r2', 'r3', 'r7', 'r5', 'r8', 'r9', 'r4']
results = []


def sh(*args):
    return subprocess.run(A + ['shell'] + list(args), capture_output=True, text=True).stdout


def w(sec):
    time.sleep(sec)


def tap(x, y):
    sh('input', 'tap', str(x), str(y))


def dump():
    subprocess.run(['perl', '-e', 'alarm 15; exec @ARGV'] + A + ['shell', 'uiautomator', 'dump', '/sdcard/ui.xml'],
                   capture_output=True)
    x = subprocess.run(A + ['exec-out', 'cat', '/sdcard/ui.xml'], capture_output=True).stdout.decode('utf-8', 'replace')
    out = []
    try:
        root = ET.fromstring(x)
    except ET.ParseError:
        return out
    for n in root.iter('node'):
        t = n.get('text') or ''
        d = n.get('content-desc') or ''
        x1, y1, x2, y2 = map(int, re.findall(r'\d+', n.get('bounds')))
        out.append((t, d, (x1 + x2) // 2, (y1 + y2) // 2))
    return out


def find(q, exact=False, nodes=None):
    for t, d, x, y in nodes if nodes is not None else dump():
        if (t == q or d == q) if exact else (q in t or q in d):
            return x, y, t or d
    return None


def tapq(q, exact=False):
    hit = find(q, exact)
    if hit:
        tap(hit[0], hit[1])
    return hit


def shot(name):
    p = f'{S}/shots/{TAG}_{name}.png'
    subprocess.run(['bash', f'{Q}/shot.sh', f'{TAG}_{name}'], capture_output=True)
    return p


def record(rid, ok, note):
    # ok=None means a person must confirm it from the screenshot: never reported as PASS.
    line = f'{rid} {"CHECK" if ok is None else "PASS" if ok else "FAIL"} {note}'
    results.append(line)
    print(line, flush=True)


def wait_for(q, secs, exact=False):
    end = time.time() + secs
    while time.time() < end:
        hit = find(q, exact)
        if hit:
            return hit
        w(3)
    return None


def to_tab(x):
    # Back only out of stacked screens: on the tabs a double Back exits the app.
    sh('am', 'start', '-n', f'{PKG}/com.anonymous.vidorax.MainActivity')
    w(2)
    sh('input', 'keyevent', '127')  # pause any playing video so the screen can be read
    w(1)
    for _ in range(4):
        nodes = dump()
        if find('Browser tab', exact=True, nodes=nodes):
            break
        sh('input', 'keyevent', '4')
        w(1.2)
    # The mini player docks above the tab bar after a video was played; it would take the tab taps.
    if find('Close player', exact=True):
        tapq('Close player', exact=True)
        w(1.5)
    names = {135: 'Browser tab', 405: 'Downloads tab', 675: 'Player tab', 945: 'Settings tab'}
    if not tapq(names[x], exact=True):
        tap(x, 2274)
    w(2.5)


def browser():
    to_tab(135)


def open_url(url, settle=20):
    browser()
    sh(f"am start -a android.intent.action.VIEW -d '{url}' {PKG}")
    w(settle)


def media_state():
    out = sh('dumpsys', 'media_session')
    m = re.search(r'package=' + PKG + r'.*?state=PlaybackState \{state=([A-Z]+)', out, re.S)
    return m.group(1) if m else None


def download_offer(icon=True):
    hit = wait_for('Video available', 40)
    if not hit:
        return False
    if icon:
        tap(1010, hit[1])
    else:
        tap(200, hit[1])
    w(4)
    if find('Don’t allow'):
        tapq('Don’t allow')
        w(3)
    return True


def downloads_row(prefix):
    to_tab(405)
    for t, d, x, y in dump():
        if d.startswith(prefix):
            return d
    return None


def wait_row(prefix, word, secs):
    end = time.time() + secs
    row = None
    while time.time() < end:
        row = downloads_row(prefix)
        if row and word in row:
            return row
        w(5)
    return row


# ------------------------------------------------------------------ steps
def r10():
    to_tab(405)
    rows = [d for t, d, x, y in dump() if d.startswith('Download. Completed')]
    tap(980, 229)  # favorites
    w(3)
    fav = find('Favorited')
    sh('input', 'keyevent', '4')
    w(1.5)
    browser()
    tap(980, 221)
    w(2)
    tapq('History', exact=True)
    w(3)
    nodes = dump()
    visited = [d for t, d, x, y in nodes if 'Visited' in d]
    searches_row = find('Clear recent searches', nodes=nodes)
    shot('r10_history')
    sh('input', 'keyevent', '4')
    record('R10', bool(rows) and bool(fav) and len(visited) >= 2,
           f'download rows={len(rows)} favorite={"yes" if fav else "no"} history={len(visited)}'
           f'{" recent-searches-row=yes" if searches_row else ""}')


def r1():
    out = subprocess.run(['bash', f'{Q}/coldstart.sh'], capture_output=True, text=True).stdout.strip()
    times = [float(x) for x in re.findall(r'at ([0-9.]+)s', out)]
    crash = 'FATAL' in sh('logcat', '-d', '-b', 'crash')
    record('R1', bool(times) and not crash,
           f'browser chrome at {", ".join(f"{t:.1f}" for t in times)} s (test1 baseline 6.2-6.4 s); crash={crash}')


def r2():
    open_url('https://www.w3schools.com/html/html5_video.asp')
    ok = download_offer()
    row = wait_row('HTML Video.', 'Completed', 90) if ok else None
    playing = None
    if row and 'Completed' in row:
        to_tab(675)
        tapq('HTML Video.')
        w(5)
        playing = media_state()
        shot('r2_player')
        sh('input', 'keyevent', '4')
        w(1)
    record('R2', bool(row and 'Completed' in row and playing in ('PLAYING', 'PAUSED')),
           f'offer={ok} row={row[:60] if row else None} player={playing}')


def r3():
    open_url('https://hlsjs.video-dev.org/demo/?src=https%3A%2F%2Ftest-streams.mux.dev%2Fx36xhzz%2Fx36xhzz.m3u8', 15)
    sh('input', 'swipe', '540', '1800', '540', '700', '500')
    w(10)
    ok = download_offer(icon=False)
    qualities = [d for t, d, x, y in dump() if re.match(r'\d+p, HLS', d)]
    sh('input', 'swipe', '540', '1700', '540', '900', '400')
    w(1.5)
    tapq('184p,')
    w(1.5)
    tapq('Download 184p')
    w(5)
    row = wait_row('hls.js demo.', 'Completed', 180)
    record('R3', bool(row and 'Completed' in row), f'offer={ok} sheet={len(qualities)}+ rows row={row[:70] if row else None}')


def r6():
    # R3 consumed this page's offer in this app run; a consumed offer is not shown again until the app restarts.
    sh('am', 'force-stop', PKG)
    sh('am', 'start', '-n', f'{PKG}/com.anonymous.vidorax.MainActivity')
    w(12)
    open_url('https://hlsjs.video-dev.org/demo/?src=https%3A%2F%2Ftest-streams.mux.dev%2Fx36xhzz%2Fx36xhzz.m3u8', 15)
    sh('input', 'swipe', '540', '1800', '540', '700', '500')
    w(10)
    download_offer(icon=False)
    for _ in range(3):  # the 288p row sits below the sheet's fold
        sh('input', 'swipe', '540', '1700', '540', '900', '400')
        w(1.5)
        if tapq('288p,'):
            break
    w(1.5)
    if not tapq('Download 288p'):
        record('R6', False, '288p not selectable in the quality sheet')
        sh('input', 'keyevent', '4')
        return
    w(3)
    shot('r6_after_download_tap')
    to_tab(405)
    a = b = None
    paused_ok = False
    if wait_for('Pause download', 60):
        tapq('Pause download')
        w(4)
        a = find(' of ')
        w(8)
        b = find(' of ')
        paused_ok = bool(find('Resume download')) and a is not None and b is not None and a[2] == b[2]
        shot('r6_paused')
        tapq('Resume download')
    end = time.time() + 420
    done = False
    while time.time() < end and not done:
        done = any('288p' in d and 'Completed' in d for t, d, x, y in dump())
        w(5)
    record('R6', paused_ok and done, f'paused at {a[2] if a else "-"}, unchanged after 8 s={paused_ok}, resumed, completed={done}')


def r7():
    to_tab(675)
    tapq('hls.js demo.')
    w(5)
    sh('input', 'keyevent', '127')  # MEDIA_PAUSE: uiautomator cannot read the screen while a video plays
    w(2)
    for _ in range(3):  # paused controls stay up once shown
        if find('Play video'):
            break
        tap(540, 1500)
        w(1)
    t = lambda: (re.findall(r"^(\d\d:\d\d)$", '\n'.join(n[0] for n in dump()), re.M) or ['?'])[0]
    t0 = t()
    tapq('Forward 10 seconds')
    w(1.5)
    t1 = t()
    tapq('Rewind 10 seconds')
    w(1.5)
    t2 = t()
    tap(543, 2069)
    w(1.5)
    t3 = t()
    tapq('Play video')
    w(2)
    state = media_state()
    w(4)  # controls auto-hide while playing; the next tap shows them
    tap(540, 1500)
    w(0.5)
    tap(1010, 202)
    w(3)
    rot = re.findall(r'mCurrentRotation=(\w+)', sh('dumpsys', 'window', 'displays'))
    sh('input', 'keyevent', '3')
    w(3)
    pinned = 'mode=pinned' in sh('dumpsys', 'activity', 'activities')
    sh('am', 'start', '-n', f'{PKG}/com.anonymous.vidorax.MainActivity')
    w(3)
    secs = lambda s: int(s[:2]) * 60 + int(s[3:]) if ':' in s else -1
    ok = (secs(t1) - secs(t0) == 10 and secs(t2) == secs(t0) and secs(t3) > 200 and state == 'PLAYING'
          and rot and rot[0] == 'ROTATION_90' and pinned)
    record('R7', ok, f'time {t0}→+10 {t1}→-10 {t2}→seek {t3}; play={state}; fullscreen={rot[:1]}; pip={pinned}')
    sh('input', 'keyevent', '4')
    w(1)


def r5():
    browser()
    tap(540, 221)
    w(2.5)
    tapq('Clear address')
    w(2)
    for c in 'youtu.be/dQw4w9WgXcQ':
        sh('input', 'text', c)
        w(0.35)
    w(1.5)
    before = sh('dumpsys', 'activity', 'top')  # noqa: F841 (kept for debugging)
    sh('input', 'keyevent', '66')  # Enter: a floating keyboard can cover the Go suggestion
    w(0.7)
    p = shot('r5_toast')
    w(3)
    nodes = dump()
    url = find('Address bar', nodes=nodes)
    sh('input', 'keyevent', '4')
    w(1)
    record('R5', None, f'toast screenshot {p} (check "YouTube downloads are not supported"); address after={url[2] if url else None}')


def r8():
    to_tab(945)
    for _ in range(3):
        sh('input', 'swipe', '540', '1900', '540', '700', '300')
    w(1.5)
    sw = None
    for t, d, x, y in dump():
        if d == 'App Lock' and x > 800:
            sw = (x, y)
    if not sw:
        record('R8', False, 'App Lock switch not found')
        return
    tap(*sw)
    w(3)
    tap(540, 775)
    w(1.5)
    for c in '1357':
        sh('input', 'text', c)
        w(0.4)
    w(2)
    for c in '1357':
        sh('input', 'text', c)
        w(0.4)
    w(3)
    sh('input', 'keyevent', '111')
    w(3)  # the setup screen scrolls when the PIN keyboard closes
    tapq("I've saved my recovery code")
    w(1.5)
    tapq('I understand')
    w(1.5)
    tapq('Enable App Lock', exact=True)
    w(3)
    if not find('Change PIN'):
        tapq('Enable App Lock', exact=True)
        w(3)
    shot('r8_after_enable')
    sh('input', 'keyevent', '3')
    w(4)
    sh('am', 'start', '-n', f'{PKG}/com.anonymous.vidorax.MainActivity')
    w(3)
    shot('r8_lock')
    locked = bool(find('Enter PIN'))
    for c in '1357':
        sh('input', 'text', c)
        w(0.4)
    w(3)
    sh('input', 'keyevent', '111')
    to_tab(945)
    for _ in range(3):
        sh('input', 'swipe', '540', '1900', '540', '700', '300')
    w(1.5)
    sw = None
    for t, d, x, y in dump():
        if d == 'App Lock' and x > 800:
            sw = (x, y)
    tap(*sw)
    w(3)
    tap(540, 712)  # the disable screen's PIN field
    w(1.5)
    for c in '1357':
        sh('input', 'text', c)
        w(0.4)
    w(3)
    tapq('DISABLE', exact=True)
    w(3)
    sh('input', 'keyevent', '3')
    w(3)
    sh('am', 'start', '-n', f'{PKG}/com.anonymous.vidorax.MainActivity')
    w(3)
    unlocked = not find('Enter PIN')
    record('R8', locked and unlocked, f'PIN asked after enable={locked}; no PIN after disable={unlocked}')


def set_language(name):
    to_tab(945)
    for _ in range(4):
        sh('input', 'swipe', '540', '700', '540', '1900', '200')
    w(1)
    tap(540, 1235)
    w(2.5)
    tapq(name)
    w(3)


def r9():
    set_language('Urdu ·')
    nodes = dump()
    urdu = [t for t, d, x, y in nodes if re.search(r'[\u0600-\u06FF]', t)]
    english = [t for t, d, x, y in nodes if t and re.fullmatch(r'[A-Za-z][A-Za-z ,.&’\'-]{3,}', t)]
    shot('r9_settings_ur')
    set_language('English')
    record('R9', len(urdu) > 10, f'Urdu strings on Settings={len(urdu)}; Latin-only labels={english[:6]}')


def r4():
    open_url('https://www.tiktok.com/@scout2015/video/6718335390845095173', 25)
    ok1 = download_offer()
    row1 = wait_row('TikTok', 'Completed', 90) if ok1 else None
    open_url('https://m.facebook.com/watch/?v=2289516264908285', 30)
    ok2 = download_offer()
    w(10)
    to_tab(405)
    fb = [d for t, d, x, y in dump() if 'Facebook · Completed' in d]
    record('R4', bool(row1 and 'Completed' in row1 and fb),
           f'tiktok offer={ok1} row={row1[:55] if row1 else None}; facebook offer={ok2} completed={len(fb)}')


for step in STEPS:
    try:
        globals()[step]()
    except Exception as e:  # keep going; a failed step is reported
        record(step.upper(), False, f'error {e!r}')

with open(f'{S}/regress_{TAG}.txt', 'w') as f:
    f.write('\n'.join(results) + '\n')
