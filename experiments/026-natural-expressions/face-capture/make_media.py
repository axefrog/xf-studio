"""Test media for the face-capture prototype (experiment 026), written to the ignored generated/media/ folder.

    make_media.py <out dir> <y4m name> <image> [<image> ...]

Copies each image as a still (for the page's image analysis) and writes a YUV4MPEG2 4:2:0 clip that holds each image for
1.5 s at 10 fps, letterboxed into 640 x 480, for Chrome's fake camera (--use-file-for-fake-video-capture). The inputs are V renders
from the Studio and CC0 photographs; nothing here is committed.
"""
import shutil
import sys
from pathlib import Path

from PIL import Image

W, H, FPS, HOLD = 640, 480, 10, 15

out, name, images = Path(sys.argv[1]), sys.argv[2], [Path(p) for p in sys.argv[3:]]
(out / 'stills').mkdir(parents=True, exist_ok=True)
with open(out / name, 'wb') as clip:
    clip.write(f'YUV4MPEG2 W{W} H{H} F{FPS}:1 Ip A1:1 C420jpeg\n'.encode())
    for path in images:
        shutil.copyfile(path, out / 'stills' / path.name)
        image = Image.open(path).convert('RGB')
        image.thumbnail((W, H))
        canvas = Image.new('RGB', (W, H), (128, 128, 128))
        canvas.paste(image, ((W - image.width) // 2, (H - image.height) // 2))
        y, u, v = canvas.convert('YCbCr').split()
        planes = y.tobytes() + u.resize((W // 2, H // 2)).tobytes() + v.resize((W // 2, H // 2)).tobytes()
        for _ in range(HOLD):
            clip.write(b'FRAME\n' + planes)
print(out / name, len(images), 'images', len(images) * HOLD, 'frames')
