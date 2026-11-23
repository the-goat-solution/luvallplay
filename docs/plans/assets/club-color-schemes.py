"""Generates club-color-schemes.json: the 12 colour schemes clubs pick from (build plan 6.3.1).
Each scheme gets a dark-mode primary and is checked against the WCAG AA contrast floors; the script lists any failure.
Run: python3 docs/plans/assets/club-color-schemes.py"""
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))
# Grounds come from the Luvallplay brand system: surface / surface-raised in each theme.
INK="#0b1b2b"; WHITE="#ffffff"; LIGHT_BG="#fafaf7"; LIGHT_RAISED="#ffffff"
DARK_BG="#0b1b2b"; DARK_RAISED="#12263a"
def worst(c, grounds): return min(cr(c,g) for g in grounds)
def hx(h): h=h.lstrip('#'); return [int(h[i:i+2],16) for i in (0,2,4)]
def to(c): return "#%02x%02x%02x"%tuple(max(0,min(255,round(v))) for v in c)
def L(h):
    f=lambda c: c/12.92 if c<=0.03928 else ((c+0.055)/1.055)**2.4
    r,g,b=[v/255 for v in hx(h)]; return .2126*f(r)+.7152*f(g)+.0722*f(b)
def cr(a,b):
    x,y=sorted([L(a),L(b)],reverse=True); return (x+.05)/(y+.05)
def mix(a,b,t): A,B=hx(a),hx(b); return to([A[i]+(B[i]-A[i])*t for i in range(3)])
SCHEMES=[
 ("court-green","Court Green","Luvallplay's own: the floor we play on, with a lime shuttle.","#0e6b4f","#d4f23c"),
 ("midnight-rally","Midnight Rally","Deep navy under hall lights, with a gold smash.","#1e3a8a","#fbbf24"),
 ("shuttle-mono","Shuttle Mono","Black and white like a feather shuttle, with a yellow strike.","#18181b","#facc15"),
 ("sunset-smash","Sunset Smash","Warm burnt orange with a sunny cream accent.","#c2410c","#fde047"),
 ("ocean-drive","Ocean Drive","Deep teal with a flamingo-pink accent.","#0f766e","#f9a8d4"),
 ("royal-drop","Royal Drop","Regal violet with a fresh mint accent.","#6d28d9","#6ee7b7"),
 ("cherry-net","Cherry Net","Bold cherry red with a golden yellow.","#be123c","#fcd34d"),
 ("electric-serve","Electric Serve","Electric blue with a hot orange.","#1d4ed8","#fb923c"),
 ("jungle-rally","Jungle Rally","Forest green with a coral pop.","#166534","#fda4af"),
 ("aurora","Aurora","Glacier cyan with a lemon glow.","#0e7490","#fef08a"),
 ("plum-clear","Plum Clear","Rich plum with an aqua flash.","#86198f","#5eead4"),
 ("arctic-smash","Arctic Smash","Ice-deep blue with an orchid accent.","#075985","#f0abfc"),
]
out=[]; problems=[]
for sid,name,desc,p,a in SCHEMES:
    on_p = WHITE if cr(WHITE,p)>=4.5 else INK
    # dark theme: lighten primary until it stands off the dark ground (3:1)
    pd=p; t=0
    while worst(pd,(DARK_BG,DARK_RAISED))<3 and t<1: t+=0.02; pd=mix(p,WHITE,t)
    # Too dark to lift a little: a monochrome scheme flips to a light fill; a coloured one keeps its hue
    # as a lighter tint carrying ink text.
    if t > 0.25:
        rgb = hx(p); sat = (max(rgb) - min(rgb)) / 255
        if sat < 0.15:
            pd = "#f4f4f5"
        else:
            while cr(INK, pd) < 4.5 and t < 1: t += 0.02; pd = mix(p, WHITE, t)
    on_pd = WHITE if cr(WHITE,pd)>=4.5 else INK
    on_a = INK
    checks={"on-primary/primary":cr(on_p,p),"primary/light-bg":cr(p,LIGHT_BG),"on-primary-dark/primary-dark":cr(on_pd,pd),
            "primary-dark/dark-grounds":worst(pd,(DARK_BG,DARK_RAISED)),"ink/accent":cr(on_a,a),"accent/dark-grounds":worst(a,(DARK_BG,DARK_RAISED)),"primary-text-link/light-grounds":worst(p,(LIGHT_BG,LIGHT_RAISED))}
    for k,v in checks.items():
        need=3 if k in("primary-dark/dark-grounds","accent/dark-grounds") else 4.5
        if v<need: problems.append((sid,k,round(v,2)))
    out.append({"id":sid,"name":name,"description":desc,
      "light":{"primary":p,"onPrimary":on_p,"accent":a,"onAccent":on_a},
      "dark":{"primary":pd,"onPrimary":on_pd,"accent":a,"onAccent":on_a},
      "contrast":{k:round(v,2) for k,v in checks.items()}})
json.dump(out,open(os.path.join(HERE, "club-color-schemes.json"),"w"),indent=2)
for s in out: print(f'{s["name"]:15s} {s["light"]["primary"]} {s["dark"]["primary"]} on-dark:{s["dark"]["onPrimary"]} ', {k:v for k,v in s["contrast"].items()})
print("PROBLEMS:",problems)
