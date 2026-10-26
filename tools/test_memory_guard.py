"""Unit tests for memory_guard's packaged-Python backstop. Platform calls are mocked.

    %LOCALAPPDATA%\\Python\\pythoncore-3.14-64\\python.exe -m unittest tools/test_memory_guard.py
"""

from __future__ import annotations

import contextlib
import io
import os
import sys
import types
import unittest
from pathlib import Path
from unittest import mock

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))

if sys.platform == "win32":
    import memory_guard as mg

REAL = r"C:\Users\someone\AppData\Local\Python\pythoncore-3.14-64\python.exe"
ALIAS = r"C:\Users\someone\AppData\Local\Microsoft\WindowsApps\python.exe"


def fake_kernel32(rc: int):
    return types.SimpleNamespace(GetCurrentPackageFullName=lambda *_: rc)


@unittest.skipUnless(sys.platform == "win32", "the guard is Windows-only")
class PackagedPythonTests(unittest.TestCase):
    def run_check(self, command, rc=15700, exe=REAL, which=None, env=None):
        """Run refuse_packaged_python with mocked platform calls; return (result, stderr)."""
        err = io.StringIO()
        with mock.patch.object(mg, "kernel32", fake_kernel32(rc)), \
                mock.patch.object(mg.sys, "executable", exe), \
                mock.patch.object(mg.sys, "_base_executable", exe, create=True), \
                mock.patch.object(mg.shutil, "which", lambda name: which), \
                mock.patch.dict(os.environ, env or {}, clear=False), \
                contextlib.redirect_stderr(err):
            if not env:
                os.environ.pop("XF_ALLOW_PACKAGED_PYTHON", None)
            return mg.refuse_packaged_python(command), err.getvalue()

    def test_plain_interpreter_and_command_pass(self):
        self.assertEqual(self.run_check(["bun", "test"]), (None, ""))

    def test_package_identity_refuses(self):
        result, err = self.run_check(["bun", "test"], rc=mg.ERROR_INSUFFICIENT_BUFFER)
        self.assertEqual(result, mg.PACKAGED_EXIT)
        self.assertIn("package identity", err)
        self.assertIn("App execution aliases", err)
        self.assertIn("pythoncore-3.14-64", err)

    def test_interpreter_under_windows_apps_refuses(self):
        result, err = self.run_check(["bun", "test"], exe=ALIAS)
        self.assertEqual(result, mg.PACKAGED_EXIT)
        self.assertIn("WindowsApps", err)

    def test_command_resolving_to_alias_refuses(self):
        for name in ("python", "python3", "py", "pip", "pip3", "python3.14", "PYTHON.EXE"):
            with self.subTest(name=name):
                result, err = self.run_check([name, "-c", "pass"], which=ALIAS)
                self.assertEqual(result, mg.PACKAGED_EXIT)
                self.assertIn("packaged-app alias", err)

    def test_command_resolving_to_real_python_passes(self):
        self.assertEqual(self.run_check(["python", "x.py"], which=REAL), (None, ""))

    def test_other_commands_are_not_resolved(self):
        self.assertEqual(self.run_check(["bun", "test"], which=ALIAS), (None, ""))
        self.assertEqual(self.run_check(["pytest"], which=ALIAS), (None, ""))

    def test_override_warns_and_runs(self):
        result, err = self.run_check(["python"], which=ALIAS, env={"XF_ALLOW_PACKAGED_PYTHON": "1"})
        self.assertIsNone(result)
        self.assertIn("running anyway", err)

    def test_errors_skip_with_one_note(self):
        result, err = self.run_check(["bun"], rc=5)
        self.assertIsNone(result)
        self.assertEqual(err.count("\n"), 1)
        self.assertIn("skipped the packaged-Python check", err)
        with mock.patch.object(mg, "kernel32", types.SimpleNamespace()):
            with contextlib.redirect_stderr(io.StringIO()) as err:
                self.assertIsNone(mg.refuse_packaged_python(["bun"]))
        self.assertIn("skipped", err.getvalue())

    def test_no_op_off_windows(self):
        with mock.patch.object(mg.sys, "platform", "linux"), \
                mock.patch.object(mg, "kernel32", fake_kernel32(0)):
            self.assertIsNone(mg.refuse_packaged_python(["python"]))

    def test_real_interpreter_is_not_packaged(self):
        """This suite runs under the full interpreter path, so the live check passes."""
        self.assertIsNone(mg.packaged_interpreter())


if __name__ == "__main__":
    unittest.main()
