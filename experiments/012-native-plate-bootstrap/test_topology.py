"""Asset-free checks for the open-surface topology gate."""
import unittest

import numpy as np

from derive import topology


class TopologyTests(unittest.TestCase):
    def test_two_separate_open_patches(self):
        faces = np.array([[0, 1, 2], [0, 2, 3], [4, 5, 6], [4, 6, 7]])
        self.assertEqual(topology(faces, 8), {
            'componentVertexCounts': [4, 4], 'boundaryEdges': 8,
            'boundaryLoops': 2, 'nonManifoldEdges': 0})

    def test_single_patch_with_a_hole(self):
        # Four quads form an annulus; its two boundary loops differ from its
        # one connected component, which caught an earlier counting mistake.
        faces = np.array([[0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5],
                          [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]])
        result = topology(faces, 8)
        self.assertEqual(result['componentVertexCounts'], [8])
        self.assertEqual(result['boundaryLoops'], 2)

    def test_three_faces_on_one_edge_are_rejected(self):
        faces = np.array([[0, 1, 2], [1, 0, 3], [0, 1, 4]])
        with self.assertRaises(AssertionError):
            topology(faces, 5)


if __name__ == '__main__':
    unittest.main()
