"""Focused offline checks for the read-only catalog boundary."""
import sys
import tempfile
import unittest
import struct
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "tools"))
from catalog_readonly import (Candidate, apply_app_fix, fnv64, launch_sources, merge_catalog, saved_appearance_matches,
                              scope_leaves, visible_files, xl_customizations, xl_resource_meta)
from archive_winners import decimal_hash, index_hashes, resolve_archive_hashes


def appearance(name, slot, choices, provider, app="base\\example.app"):
    return {"name": name, "uiSlot": slot, "link": "None", "type": "gameuiAppearanceInfo",
            "provider": provider, "app": app, "choices": [{"name": c, "provider": provider} for c in choices]}


def archive(path, hashes):
    path.parent.mkdir(parents=True, exist_ok=True)
    index = bytearray(28 + 56 * len(hashes))
    struct.pack_into("<I", index, 16, len(hashes))
    for offset, value in enumerate(hashes):
        struct.pack_into("<Q", index, 28 + 56 * offset, value)
    header = bytearray(24)
    header[:4] = b"RDAR"
    struct.pack_into("<Q", header, 8, 24)
    path.write_bytes(header + index)


class CatalogProbeTests(unittest.TestCase):
    def test_archive_index_rejects_truncation_and_unsigned_overflow(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "bad.archive"
            archive(path, [2**64 - 1])
            self.assertEqual(index_hashes(path, {2**64 - 1}), {2**64 - 1})
            self.assertEqual(decimal_hash("018446744073709551615"), str(2**64 - 1))
            with self.assertRaisesRegex(ValueError, "decimal uint64"):
                decimal_hash(str(2**64))
            path.write_bytes(path.read_bytes()[:-1])
            with self.assertRaisesRegex(ValueError, "outside file"):
                index_hashes(path, {2**64 - 1})

    def test_archive_hash_order_and_route_keep_physical_candidates_separate(self):
        hashed = "7140168419554698265"
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            base = root / "base"
            archive(base / "basegame.archive", [3])
            game_mod = root / "game" / "archive" / "pc" / "mod"
            archive(game_mod / "Z_Eyes.archive", [int(hashed)])
            mo2 = root / "MO2"
            for name, filename in (("Low", "A_Eyes.archive"), ("High", "B_Eyes.archive"),
                                   ("Disabled", "0_Eyes.archive")):
                archive(mo2 / "mods" / name / "archive" / "pc" / "mod" / filename, [int(hashed)])
            selected = mo2 / "profiles" / "Active"
            selected.mkdir(parents=True)
            (selected / "modlist.txt").write_text("+Low\n+High\n-Disabled\n")
            (mo2 / "ModOrganizer.ini").write_text("selected_profile=@ByteArray(Active)\n"
                                                   "enforce_archive_load_order=false\n"
                                                   "reverse_archive_load_order=false\n")
            direct, manual, _ = launch_sources("direct", game_mod, mo2, "Active")
            direct_result = resolve_archive_hashes(visible_files(direct + manual), [hashed], base_roots=[base])
            self.assertEqual(direct_result["resource_hashes"][hashed]["source_derived_winner"]["name"], "z_eyes.archive")
            self.assertEqual(len(direct_result["resource_hashes"][hashed]["physical_candidates"]), 1)
            staged, manual, _ = launch_sources("mo2", game_mod, mo2, "Active")
            result = resolve_archive_hashes(visible_files(staged + manual), [hashed], base_roots=[base])
            row = result["resource_hashes"][hashed]
            self.assertEqual(row["source_derived_winner"]["provider"], "Low")
            self.assertIsNone(row["runtime_observed_winner"])
            self.assertEqual(len(row["physical_candidates"]), 4)
            self.assertEqual(len(row["visible_candidates"]), 3)
            self.assertEqual(row["confidence"], "source-derived")
            (mo2 / "overwrite" / "archive" / "pc" / "mod").mkdir(parents=True)
            (mo2 / "overwrite" / "archive" / "pc" / "mod" / "modlist.txt").write_text(
                "B_Eyes.archive\nA_Eyes.archive\nZ_Eyes.archive\n")
            staged, manual, _ = launch_sources("mo2", game_mod, mo2, "Active")
            listed = resolve_archive_hashes(visible_files(staged + manual), [hashed], base_roots=[base])
            self.assertEqual(listed["resource_hashes"][hashed]["source_derived_winner"]["provider"], "High")

    def test_ambiguous_archive_file_blocks_winner(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            base = root / "base"
            base.mkdir()
            one, two = root / "one.archive", root / "two.archive"
            archive(one, [42])
            archive(two, [42])
            same = r"archive\pc\mod\same.archive"
            rows = [Candidate("manual", same, str(one), True, None, "manual"),
                    Candidate("mo2", same, str(two), True, 3, "mo2")]
            result = resolve_archive_hashes(visible_files(rows), ["42"], base_roots=[base])
            self.assertIsNone(result["resource_hashes"]["42"]["source_derived_winner"])
            self.assertEqual(len(result["resource_hashes"]["42"]["physical_candidates"]), 2)
            self.assertIn("ambiguous", " ".join(result["resource_hashes"]["42"]["gaps"]))

    def test_missing_coverage_and_base_collision_stay_unresolved(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            base = root / "base"
            mod = root / "mod.archive"
            archive(base / "game.archive", [42])
            archive(mod, [42])
            virtual = r"archive\pc\mod\mod.archive"
            files = visible_files([Candidate("mod", virtual, str(mod), True, 1, "mo2")])
            no_base = resolve_archive_hashes(files, ["42"])["resource_hashes"]["42"]
            self.assertIsNone(no_base["source_derived_winner"])
            self.assertIn("base archives not supplied", " ".join(no_base["gaps"]))
            collision = resolve_archive_hashes(files, ["42"], base_roots=[base])["resource_hashes"]["42"]
            self.assertIsNone(collision["source_derived_winner"])
            self.assertEqual(len(collision["visible_candidates"]), 2)
            self.assertIn("base-game versus mod", " ".join(collision["gaps"]))

    def test_launch_route_excludes_staged_mo2_from_direct_game_view(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            manual = root / "game" / "archive" / "pc" / "mod"
            manual.mkdir(parents=True)
            (manual / "eyes.xl").write_text("customizations: {}\n")
            mo2 = root / "MO2"
            staged = mo2 / "mods" / "Eye Pack" / "archive" / "pc" / "mod"
            staged.mkdir(parents=True)
            (staged / "eyes.xl").write_text("customizations: {}\n")
            selected = mo2 / "profiles" / "Active"
            selected.mkdir(parents=True)
            (selected / "modlist.txt").write_text("+Eye Pack\n")
            (mo2 / "ModOrganizer.ini").write_text("selected_profile=@ByteArray(Active)\n"
                                                   "enforce_archive_load_order=false\n"
                                                   "reverse_archive_load_order=false\n")

            direct_mo, direct_manual, direct_meta = launch_sources("direct", manual, mo2, "Active")
            self.assertEqual(direct_mo, [])
            self.assertEqual(len(direct_manual), 1)
            self.assertEqual(direct_meta["kind"], "direct")
            self.assertEqual(visible_files(direct_mo + direct_manual)
                             [r"archive\pc\mod\eyes.xl"]["winner"]["provider"], "manual game mod")

            staged_mo, staged_manual, staged_meta = launch_sources("mo2", manual, mo2, "Active")
            self.assertEqual((len(staged_mo), len(staged_manual)), (1, 1))
            self.assertEqual(staged_meta["kind"], "mo2")
            self.assertIsNone(visible_files(staged_mo + staged_manual)
                              [r"archive\pc\mod\eyes.xl"]["winner"])
            with self.assertRaisesRegex(ValueError, "requires --mo2-root"):
                launch_sources("mo2", manual)

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
