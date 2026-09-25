"""CC light rig in the puppet frame and in Studio (Three.js) coordinates.

Frames:
  RED world: Z up, entity forward +Y (yaw rotates +Y about +Z, counter-clockwise).
  Puppet frame: origin at the scene marker (floor), forward f = yaw(-125 deg) applied to +Y,
  right = cross(f, up).
  Studio/Three: Y up, character faces -Z, anatomical right = +X (WolvenKit GLB: (x, y, z)_RED -> (x, z, -y)).
  A puppet-frame point (right r, forward q, up u) maps to Three (r, u, -q).
"""
import json, math, sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rig import rig

YAW = float(sys.argv[2]) if len(sys.argv) > 2 else -125.0
HEAD_UP = float(sys.argv[3]) if len(sys.argv) > 3 else 1.62


def yaw_vec(deg):
    t = math.radians(deg)
    return (-math.sin(t), math.cos(t), 0.0)


f = yaw_vec(YAW)
r = (f[1], -f[0], 0.0)  # cross(f, z)


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def to_puppet(v):
    return (dot(v, r), dot(v, f), v[2])


origin, lights = rig(sys.argv[1])
head = (0.0, 0.0, HEAD_UP)  # slot X offset (-0.03) ignored; it is in the marker frame, not the puppet frame
rows = []
for l in lights:
    p = to_puppet(l['rel'])
    d = to_puppet(l['fwd'])
    to_head = tuple(h - x for h, x in zip(head, p))
    dist = math.sqrt(dot(to_head, to_head))
    cosang = dot(to_head, d) / dist
    off = math.degrees(math.acos(max(-1, min(1, cosang))))
    az = math.degrees(math.atan2(p[0], p[1]))  # 0 = straight in front, +90 = character's right
    el = math.degrees(math.atan2(p[2] - HEAD_UP, math.hypot(p[0], p[1])))
    three = (round(p[0], 3), round(p[2], 3), round(-p[1], 3))
    three_dir = (round(d[0], 3), round(d[2], 3), round(-d[1], 3))
    rows.append(dict(name=l['name'].strip('{}'), three_pos=three, three_dir=three_dir, dist_to_head=round(dist, 2),
                     azimuth=round(az), elevation=round(el), head_off_axis=round(off, 1), half_angle_outer=l['outer'] / 2,
                     inner=l['inner'], outer=l['outer'], lm=l['intensity'], color=l['color'][:3] if l['color'][3] else 'default',
                     atten=l['atten'], radius=l['radius'], shadows=l['shadows'], contact=l['contact'], rbias=l['roughnessBias'],
                     srcR=l['sourceRadius'], soft=l['softness']))
for x in sorted(rows, key=lambda x: x['name']):
    print(json.dumps(x))
