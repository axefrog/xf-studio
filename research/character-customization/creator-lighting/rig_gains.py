"""Relative light contributions at the head under stated hypotheses.

Decoded [source] (clustered local-light loop, program 10862954502888615639):
  inverse square: saturate(1 - (d/r)^4)^2 / max(d^2, 1e-4), optionally clamped (world lightAttenuationClamp 12)
  linear:         1 - saturate(d/r)
  spot:           pow(saturate(a*cos + b), c) with CPU-made a, b, c
Hypotheses here: a, b from full cone angles (inner/outer), c = softness; I = lumen/(4*pi);
colour is 8-bit sRGB, decoded to linear; unset (zero, alpha 0) colour = white.
"""
import json, math, subprocess, sys

import os
rows = [json.loads(l) for l in subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'rig_table.py')] + [a for a in sys.argv[1:] if a != '--half'],
                                              capture_output=True, text=True).stdout.splitlines()]
HALF = '--half' in sys.argv  # treat angles as half-angles instead of full cone angles


def dec(c):
    c = c / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


tot = [0, 0, 0]
out = []
for x in rows:
    d, r = x['dist_to_head'], x['radius']
    if x['atten'] == 'LA_InverseSquare':
        att = min(max(0, 1 - (d / r) ** 4) ** 2 / max(d * d, 1e-4), 12)
    else:
        att = 1 - min(max(d / r, 0), 1)
    k = 1 if HALF else 0.5
    co, ci = math.cos(math.radians(x['outer'] * k)), math.cos(math.radians(max(x['inner'], 0.01) * k))
    ct = math.cos(math.radians(x['head_off_axis']))
    cone = max(0, min(1, (ct - co) / max(ci - co, 1e-4))) ** x['soft']
    I = x['lm'] / (4 * math.pi)
    col = (1, 1, 1) if x['color'] == 'default' else tuple(dec(c) for c in x['color'])
    e = I * att * cone
    for i in range(3):
        tot[i] += e * col[i]
    out.append((x['name'], round(att, 3), round(cone, 3), round(e, 3), tuple(round(c, 3) for c in col)))
m = max(o[3] for o in out) or 1
for o in sorted(out, key=lambda o: -o[3]):
    print(f"{o[0]:18s} att={o[1]:<6} cone={o[2]:<6} E={o[3]:<6} rel={o[3]/m:.2f} colour_lin={o[4]}")
print('sum RGB (arbitrary units):', [round(t, 3) for t in tot])
