"""Focused offline checks for the read-only catalog boundary."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "tools"))
from catalog_readonly import Candidate, fnv64, merge_catalog, saved_appearance_matches, visible_files, xl_customizations


def appearance(name, slot, choices, provider, app="base\\example.app"):
    return {"name": name, "uiSlot": slot, "link": "None", "type": "gameuiAppearanceInfo",
            "provider": provider, "app": app, "choices": [{"name": c, "provider": provider} for c in choices]}


class CatalogProbeTests(unittest.TestCase):
    def test_file_priority_disabled_and_cross_provider_ambiguity(self):
        rows = [Candidate("low", r"archive\pc\mod\a.xl", "low", True, 1, "mo2"),
                Candidate("high", r"archive\pc\mod\a.xl", "high", True, 2, "mo2"),
                Candidate("disabled", r"archive\pc\mod\a.xl", "off", False, 99, "mo2")]
        key = r"archive\pc\mod\a.xl"
        resolved = visible_files(rows)[key]
        self.assertEqual(resolved["winner"]["provider"], "high")
        self.assertEqual(len(resolved["candidates"]), 3)
        ambiguous = visible_files(rows + [Candidate("manual", key, "manual", True, None, "manual")])[key]
        self.assertIsNone(ambiguous["winner"])

    def test_xl_scalar_and_list_registration(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "a.xl"
            path.write_text("customizations:\n  female:\n    - a\\one.inkcharcustomization\n    - b\\two.inkcharcustomization\n  male: c\\three.inkcharcustomization\nresource:\n  link: {}\n")
            found, gaps = xl_customizations(path)
            self.assertEqual(found["female"], [r"a\one.inkcharcustomization", r"b\two.inkcharcustomization"])
            self.assertEqual(found["male"], [r"c\three.inkcharcustomization"])
            self.assertFalse(gaps)

    def test_anonymous_slot_overlay_keeps_choice_provenance(self):
        base = {"options": {"head": [appearance("eyes_color", "eyes_color", ["brown"], "base")],
                            "body": [], "arms": []}}
        mod = {"provider": "mod", "options": {"head": [appearance("None", "eyes_color", ["brown", "blue"], "mod")],
                                                    "body": [], "arms": []}}
        merged = merge_catalog(base, [mod])
        eye = merged["options"]["head"][0]
        self.assertEqual([(x["name"], x["provider"]) for x in eye["choices"]],
                         [("brown", "mod"), ("blue", "mod")])
        self.assertEqual(eye["sources"], ["base", "mod"])
        self.assertEqual(merged["overlays"][0]["match"], "uiSlot/link")

    def test_large_saved_hash_requires_exact_app_and_definition(self):
        app = r"base\example.app"
        hash_ = fnv64(app)
        self.assertGreater(int(hash_), 2**53)
        base = {"options": {"head": [appearance("eyes", "eyes", ["eye_16"], "base", app)],
                            "body": [], "arms": []}}
        merged = merge_catalog(base, [])
        self.assertEqual(len(saved_appearance_matches(merged, hash_, "eye_16")), 1)
        self.assertEqual(saved_appearance_matches(merged, hash_, "eye_17"), [])
        self.assertEqual(saved_appearance_matches(merged, str(int(hash_) + 1), "eye_16"), [])


if __name__ == "__main__":
    unittest.main()
