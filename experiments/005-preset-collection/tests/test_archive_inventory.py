import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from archive_inventory import depot_path, inventory, path_hash


PLAN = {
    'mesh': 'axefrog/studio/models/xfs_eye.mesh',
    'morph': 'axefrog/studio/models/xfs_eye.morphtarget',
    'app': 'axefrog/studio/xfs_collection.app',
    'customization': 'axefrog/studio/xfs_collection.inkcharcustomization',
    'presets': [{'textures': {
        'diffuse': 'axefrog/studio/textures/xfs_p_diffuse.xbm',
        'roughness': 'axefrog/studio/textures/xfs_p_roughness.xbm',
        'metalness': 'axefrog/studio/textures/xfs_p_metalness.xbm',
    }}],
}


class ArchiveInventoryTests(unittest.TestCase):
    def test_hash_matches_wolvenkit_source_vectors(self):
        self.assertEqual(path_hash('base/characters/head.mesh'), 8995421073019654957)
        self.assertEqual(depot_path('base/characters/head.mesh'), r'base\characters\head.mesh')

    def test_rejects_paths_wolvenkit_would_sanitize_or_skip(self):
        for value in ('/base/test.mesh', 'base//test.mesh', 'base/../test.mesh',
                      'base/./test.mesh', 'Base/test.mesh', 'base\\test.mesh',
                      'base/test .mesh', 'base/test.txt', '12345.mesh',
                      'base/trailing./test.mesh'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                depot_path(value)

    def test_exact_inventory_and_content_digest(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for relative in [PLAN[key] for key in ('mesh', 'morph', 'app', 'customization')] + list(PLAN['presets'][0]['textures'].values()):
                file = root / relative
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_bytes(relative.encode('ascii'))
            records = inventory(root, PLAN)
            self.assertEqual(len(records), 7)
            self.assertEqual([record['path'] for record in records], sorted(record['path'] for record in records))
            self.assertTrue(all(len(record['sha256']) == 64 for record in records))
            (root / PLAN['mesh']).write_bytes(b'changed')
            self.assertNotEqual(inventory(root, PLAN), records)
            (root / 'axefrog/studio/extra.mesh').write_bytes(b'extra')
            with self.assertRaisesRegex(ValueError, 'extra='):
                inventory(root, PLAN)
            (root / 'axefrog/studio/extra.mesh').unlink()
            (root / PLAN['mesh']).unlink()
            with self.assertRaisesRegex(ValueError, 'missing='):
                inventory(root, PLAN)

    def test_duplicate_plan_path_is_rejected(self):
        plan = {**PLAN, 'morph': PLAN['mesh']}
        with tempfile.TemporaryDirectory() as tmp, self.assertRaisesRegex(ValueError, 'duplicate'):
            inventory(tmp, plan)

    def test_path_hash_collision_is_rejected_before_pack(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for relative in [PLAN[key] for key in ('mesh', 'morph', 'app', 'customization')] + list(PLAN['presets'][0]['textures'].values()):
                file = root / relative
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_bytes(b'content')
            with patch('archive_inventory.path_hash', return_value=1), self.assertRaisesRegex(ValueError, 'collision'):
                inventory(root, PLAN)


if __name__ == '__main__':
    unittest.main()
