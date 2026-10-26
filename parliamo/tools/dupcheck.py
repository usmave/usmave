#!/usr/bin/env python3
"""Aufruf: printf "il cane\nla parola\n" | python3 tools/dupcheck.py [bereich …]
Prüft Kandidaten (eine pro Zeile auf stdin) gegen alle vorhandenen Einträge.
Vergleicht normalisiert: Klammern entfernt, Akzente/Apostrophe vereinheitlicht, alle Alternativen."""
import sys, re, glob, unicodedata, os
ROOT=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','data','areas')
def norm(s):
    s=re.sub(r'\([^)]*\)','',s)
    s=re.sub(r'\{([^{}|]*)\|[^{}|]*\}',r'\1',s)
    s=s.lower().replace('’',"'").replace("'",' ')
    s=unicodedata.normalize('NFD',s); s=''.join(c for c in s if unicodedata.category(c)!='Mn')
    s=re.sub(r'[^a-z0-9 ]',' ',s)
    return re.sub(r'\s+',' ',s).strip()
idx={}
skip=set(sys.argv[1:])
for f in sorted(glob.glob(ROOT+'/*.js')):
    area=os.path.basename(f)[:-3]
    if area in skip: continue
    for line in open(f,encoding='utf-8'):
        line=line.rstrip('\n')
        if not line or line.startswith(('export', '`', '//')): continue
        if re.match(r'^[!#@DRQ?=/PTNMAE] ', line) or re.match(r'^#[AB][12]', line): continue
        if '||' in line: continue
        if '|' not in line: continue
        it=line[2:] if line.startswith('> ') else line
        first=it.split('|')[0]
        for alt in first.split(' / '):
            k=norm(alt)
            if k: idx.setdefault(k,[]).append(area)
for cand in sys.stdin:
    cand=cand.strip()
    if not cand: continue
    hits=set()
    for alt in cand.split(' / '):
        k=norm(alt)
        if k in idx: hits.update(idx[k])
    if hits: print(f'{cand} → {", ".join(sorted(hits))}')
