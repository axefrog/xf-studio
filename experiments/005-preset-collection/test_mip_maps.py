import tempfile
import unittest
from pathlib import Path

import numpy as np

from mip_maps import dds_bytes, destination_contributions, mip_levels, read_dds_levels


class FlatMipTests(unittest.TestCase):
    def test_checkerboard_preserves_destination_coverage_and_colour(self):
        # Half red matte and half blue metallic. An ordinary box on encoded
        # alpha would yield (.5)^2=.25 coverage, rather than the required .5.
        diffuse = np.zeros((2, 2, 4), dtype=np.uint8)
        diffuse[0, 0] = (255, 0, 0, 255)
        diffuse[1, 1] = (255, 0, 0, 255)
        rough = np.array([[224, 0], [0, 224]], dtype=np.uint8)
        metal = np.zeros((2, 2), dtype=np.uint8)
        colour_levels, rough_levels, metal_levels = mip_levels(diffuse.tobytes(), rough.tobytes(), metal.tobytes(), 2)
        self.assertEqual(colour_levels[0], diffuse.tobytes())
        self.assertEqual(rough_levels[0], rough.tobytes())
        self.assertEqual(metal_levels[0], metal.tobytes())
        single = np.frombuffer(colour_levels[1], dtype=np.uint8).reshape(1, 1, 4)
        self.assertAlmostEqual((single[0, 0, 3] / 255) ** 2, .5, delta=.003)
        self.assertEqual(single[0, 0, :3].tolist(), [255, 0, 0])
        self.assertEqual(rough_levels[1], bytes([224]))
        contribution = destination_contributions(single, np.frombuffer(rough_levels[1], dtype=np.uint8).reshape(1, 1),
                                                   np.frombuffer(metal_levels[1], dtype=np.uint8).reshape(1, 1))
        self.assertAlmostEqual(contribution[0, 0, 0], .5, delta=.003)
        self.assertAlmostEqual(contribution[0, 0, 3], .5 * 224 / 255, delta=.003)

    def test_overlapping_colour_is_averaged_in_encoded_destination_space(self):
        diffuse = np.array([[[255, 0, 0, 255], [0, 0, 255, 255]],
                            [[255, 0, 0, 255], [0, 0, 255, 255]]], dtype=np.uint8)
        rough = np.array([[50, 200], [50, 200]], dtype=np.uint8)
        metal = np.array([[0, 255], [0, 255]], dtype=np.uint8)
        colour, r, m = mip_levels(diffuse.tobytes(), rough.tobytes(), metal.tobytes(), 2)
        combined = np.frombuffer(colour[1], dtype=np.uint8).reshape(1, 1, 4)
        channels = destination_contributions(combined, np.frombuffer(r[1], dtype=np.uint8).reshape(1, 1),
                                             np.frombuffer(m[1], dtype=np.uint8).reshape(1, 1))
        self.assertEqual(combined[0, 0, 3], 255)
        self.assertAlmostEqual(channels[0, 0, 0], .5, delta=.004)
        self.assertAlmostEqual(channels[0, 0, 2], .5, delta=.004)
        self.assertAlmostEqual(channels[0, 0, 3], 125 / 255, delta=.004)
        self.assertAlmostEqual(channels[0, 0, 4], .5, delta=.004)

    def test_channels_share_complete_dds_chain_and_reject_malformed_input(self):
        size = 4
        diffuse = bytes([32, 64, 128, 128] * size * size)
        scalar = bytes([90] * size * size)
        levels = mip_levels(diffuse, scalar, scalar, size)
        self.assertEqual([len(x) for x in levels[0]], [64, 16, 4])
        self.assertEqual([len(x) for x in levels[1]], [16, 4, 1])
        with tempfile.TemporaryDirectory() as directory:
            for channel, index in [('diffuse', 0), ('roughness', 1), ('metalness', 2)]:
                path = Path(directory) / f'{channel}.dds'
                path.write_bytes(dds_bytes(levels[index], size, channel))
                width, read = read_dds_levels(path, channel)
                self.assertEqual(width, size)
                self.assertEqual([x.tobytes() for x in read], levels[index])
        with self.assertRaises(ValueError):
            mip_levels(diffuse[:-1], scalar, scalar, size)
        with self.assertRaises(ValueError):
            dds_bytes(levels[0][:-1], size, 'diffuse')


if __name__ == '__main__':
    unittest.main()
