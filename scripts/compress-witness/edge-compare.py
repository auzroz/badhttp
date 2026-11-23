# Compare two /compress edge probe matrices cell by cell (status, coding, decode, hash; wire bytes only where both are identity).
# Usage: python3 scripts/compress-witness/edge-compare.py docs/probe-compress-2026-09-01.txt docs/probe-compress-edge-2026-11-23.txt
# Maps the 09-01 flavor names that were renamed later (mismatch, unknown). Session 38.
import re, sys
REN={'mismatch':'not-compressed','unknown':'unknown-coding'}
def parse(p):
    out={}; proto=None
    for line in open(p):
        if line.startswith('################'): proto=line.split()[-1]; continue
        m=re.match(r'^(\S+)\s+ae=(.*?)\s+rc=(\S+)\s+(\S*) ce=\[(.*?)\] cl=\[(.*?)\] wire=(\d+) first=(\S*) plain=(\S*) dec=(\S+) (\S+) vary=\[(.*?)\]',line)
        if not m or not proto: continue
        f,ae,rc,st,ce,cl,wire,first,plain,dec,sha,vary=m.groups()
        f=REN.get(f,f)
        out[(proto,f,ae.strip())]=dict(st=st,ce=ce,wire=int(wire),dec=dec,sha=sha,first=first)
    return out
a=parse(sys.argv[1]); b=parse(sys.argv[2])
common=[k for k in a if k in b]
print(f'cells: old {len(a)} new {len(b)} common {len(common)}')
diffs=0
for k in sorted(common):
    x,y=a[k],b[k]
    d=[f for f in ('st','ce','dec','sha') if x[f]!=y[f]]
    # wire only matters when the body is identity on both (compressed byte counts belong to zlib)
    if x['ce']=='' and y['ce']=='' and x['wire']!=y['wire']: d.append('wire')
    if d:
        diffs+=1; print(k, {f:(x[f],y[f]) for f in d})
print('differing cells:', diffs)
