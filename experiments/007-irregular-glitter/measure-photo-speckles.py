"""Bounded luminance-peak comparison on local, undistributed reference photos.

This is a contrast proxy, not a count of physical cosmetic particles. It uses
small manually selected eyelid rectangles and a 7px median background. Run
with the two locally retained glitter-reference-6/7 paths as arguments.
"""
import sys
from PIL import Image, ImageFilter, ImageChops

for path, box in zip(sys.argv[1:], [(210, 300, 610, 435), (170, 320, 590, 485)]):
    im = Image.open(path).convert("L").crop(box)
    high = ImageChops.subtract(im, im.filter(ImageFilter.MedianFilter(7)))
    w, h = high.size
    print(path, "ROI", (w, h))
    for threshold in (20, 30, 40, 50):
        data = list(high.get_flattened_data())
        live = {i for i, v in enumerate(data) if v >= threshold}
        pixels = len(live)
        components = []
        while live:
            start = live.pop()
            queue = [start]
            for point in queue:
                x, y = point % w, point // w
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        xx, yy = x + dx, y + dy
                        if 0 <= xx < w and 0 <= yy < h:
                            other = yy * w + xx
                            if other in live:
                                live.remove(other)
                                queue.append(other)
            components.append(len(queue))
        small = [size for size in components if 1 <= size <= 30]
        print(threshold, {"brightPixels": pixels, "smallComponents": len(small),
                          "medianSmallArea": sorted(small)[len(small)//2] if small else 0,
                          "largestArea": max(components, default=0)})
