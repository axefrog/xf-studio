"""Focused offline checks for the read-only catalog boundary."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "tools"))
from catalog_readonly import (Candidate, apply_app_fix, fnv64, merge_catalog, saved_appearance_matches,
                              scope_leaves, visible_files, xl_customizations, xl_resource_meta)


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

    def test_installed_style_fix_scope_and_custom_choice_compose(self):
        old = r"base\characters\head\basehead.app"
        dynamic = r"archive_xl\characters\head\basehead_pwa.app"
        with tempfile.TemporaryDirectory() as folder:
            fix = Path(folder) / "fix.xl"
            scope = Path(folder) / "scope.xl"
            fix.write_text("resource:\n  fix:\n    base\\female.inkcharcustomization: &Female\n"
                           f"      paths:\n        {old}: {dynamic}\n"
                           "    base\\male.inkcharcustomization: *Female\n"
                           "    base\\face.mesh:\n      names:\n        old: new\n")
            scope.write_text("resource:\n  scope:\n    player_customization.app:\n"
                             "      - player_wa_eyes.app\n    player_wa_eyes.app:\n"
                             f"      - {dynamic}\n")
            fixes, _ = xl_resource_meta(fix)
            _, scopes = xl_resource_meta(scope)
            self.assertEqual(fixes[r"base\female.inkcharcustomization"][old], dynamic)
            self.assertEqual(scope_leaves("player_customization.app", scopes), {dynamic})
            base = {"options": {"head": [appearance("eyes_color", "eyes_color", ["vanilla"], "game", old)],
                                "body": [], "arms": []}}
            mod = {"provider": "Unique Eyes", "options": {"head": [appearance("None", "eyes_color", ["eye_16_diffuse"], "Unique Eyes", "")],
                                                         "body": [], "arms": []}}
            fixed = apply_app_fix(base, fixes[r"base\female.inkcharcustomization"],
                                  scope_leaves("player_customization.app", scopes), {"provider": "ArchiveXL"})
            merged = merge_catalog(fixed, [mod])
            matches = saved_appearance_matches(merged, fnv64(dynamic), "eye_16_diffuse")
            self.assertEqual(len(matches), 1)
            self.assertEqual(matches[0]["choice_provider"], "Unique Eyes")
            self.assertEqual(matches[0]["app_original"], old)
            self.assertEqual(matches[0]["app_resolution"]["provider"], "ArchiveXL")
            self.assertEqual(saved_appearance_matches(merged, fnv64(dynamic), "vanilla_missing"), [])
            unscoped = apply_app_fix(base, fixes[r"base\female.inkcharcustomization"], set(), {})
            self.assertEqual(saved_appearance_matches(merge_catalog(unscoped, [mod]), fnv64(dynamic), "eye_16_diffuse"), [])


if __name__ == "__main__":
    unittest.main()
