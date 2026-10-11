#!/usr/bin/env python3
# usage: ui.py dump            -> list text/desc + centre of clickable-ish nodes
#        ui.py tap "<text>"    -> tap the first node whose text or content-desc contains <text>
import subprocess, sys, re, xml.etree.ElementTree as ET
import os; A=['adb','-s',os.environ.get('ANDROID_SERIAL','emulator-5554')]
def dump():
    subprocess.run(['perl','-e','alarm 15; exec @ARGV']+A+['shell','uiautomator','dump','/sdcard/ui.xml'],capture_output=True)
    x=subprocess.run(A+['exec-out','cat','/sdcard/ui.xml'],capture_output=True).stdout.decode('utf-8','replace')
    return ET.fromstring(x)
def nodes(root):
    for n in root.iter('node'):
        t=n.get('text') or ''; d=n.get('content-desc') or ''
        b=re.findall(r'\d+',n.get('bounds'))
        x1,y1,x2,y2=map(int,b)
        yield t,d,(x1+x2)//2,(y1+y2)//2,n
cmd=sys.argv[1]
r=dump()
if cmd=='dump':
    for t,d,x,y,n in nodes(r):
        if t or d: print(f'{x},{y}\t{t!r}\t{d!r}')
elif cmd=='tap':
    q=sys.argv[2]; idx=int(sys.argv[3]) if len(sys.argv)>3 else 0
    exact=q.startswith('=');
    q=q[1:] if exact else q
    hits=[(t,d,x,y) for t,d,x,y,n in nodes(r) if ((t==q or d==q) if exact else (q in t or q in d))]
    if len(hits)<=idx: print('NOT FOUND',q); sys.exit(1)
    t,d,x,y=hits[idx]; subprocess.run(A+['shell','input','tap',str(x),str(y)]); print('tapped',repr(t or d),x,y)
