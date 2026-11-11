"""Offline-only regression checks for an explicitly approved Production Script-API source takeover."""
import importlib.util
import os
import pathlib
import sys
import tempfile
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[1]
GUARD_PATH = ROOT / "scripts" / "guard-production-release.py"
WORKFLOW_PATH = ROOT / ".github" / "workflows" / "production-deploy.yml"
spec = importlib.util.spec_from_file_location("production_release_guard", GUARD_PATH)
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class ProductionApiOriginGuardTests(unittest.TestCase):
    def run_check(self, expected_deployment):
        with tempfile.TemporaryDirectory() as folder, \
             mock.patch.dict(os.environ, {
                 "TARGET": "worker",
                 "EXPECTED_CURRENT": "f4456933-cc48-49c0-9412-480ea1074daf",
                 "EXPECTED_DEPLOYMENT": expected_deployment,
                 "RUNNER_TEMP": folder,
             }, clear=False), \
             mock.patch.object(sys, "argv", [str(GUARD_PATH), "before"]), \
             mock.patch.object(guard, "check_bindings", return_value={"bindings": "unchanged"}), \
             mock.patch.object(guard, "live_id", return_value=(
                 "f4456933-cc48-49c0-9412-480ea1074daf",
                 "9f7e5aea-e20d-4b48-9d71-de936de1ec05"
             )):
            guard.main()

    def test_exact_deployment_pin_matches(self):
        self.run_check("9f7e5aea-e20d-4b48-9d71-de936de1ec05")

    def test_different_deployment_id_rejected_even_if_version_matches(self):
        with self.assertRaisesRegex(RuntimeError, "deployment ID changed"):
            self.run_check("00000000-0000-0000-0000-000000000000")

    def test_wrong_worker_version_is_rejected_even_if_deployment_matches(self):
        with self.assertRaisesRegex(RuntimeError, "Production changed after approval"):
            with mock.patch.object(guard, "live_id", return_value=(
                "00000000-0000-0000-0000-000000000000",
                "9f7e5aea-e20d-4b48-9d71-de936de1ec05"
            )):
                # The run_check helper mocks both bindings and active ID; instead
                # patch the real guard's input state explicitly for this case.
                with tempfile.TemporaryDirectory() as folder, \
                     mock.patch.dict(os.environ, {
                         "TARGET": "worker",
                         "EXPECTED_CURRENT": "f4456933-cc48-49c0-9412-480ea1074daf",
                         "EXPECTED_DEPLOYMENT": "9f7e5aea-e20d-4b48-9d71-de936de1ec05",
                         "RUNNER_TEMP": folder,
                     }, clear=False), \
                     mock.patch.object(sys, "argv", [str(GUARD_PATH), "before"]), \
                     mock.patch.object(guard, "check_bindings", return_value={"bindings": "unchanged"}):
                    guard.main()

    def test_default_mode_preserves_strict_and_independent_release_gates(self):
        text = WORKFLOW_PATH.read_text()
        self.assertIn("default: deny", text)
        self.assertIn("--no-bundle --keep-vars --strict", text)
        self.assertIn('test "$RELEASE_MODE:$TARGET" = "deploy:worker"', text)
        self.assertIn('test "$API_ORIGIN_TAKEOVER_CONFIRMATION" = "ACKNOWLEDGE_WORKER_SCRIPT_API_SOURCE_OVERWRITE"', text)
        self.assertIn('[[ "$EXPECTED_DEPLOYMENT" =~ ^[0-9a-f-]{36}$ ]]', text)
        self.assertIn("python3 -m unittest discover", text)
        self.assertIn("api_origin_takeover_confirmation", text)
        self.assertIn("ACKNOWLEDGE_WORKER_SCRIPT_API_SOURCE_OVERWRITE", text)
        self.assertIn("DEPLOY_WORKER_TO_PRODUCTION", text)
        self.assertIn('environment:\n      name: production', text)
        self.assertIn('python3 scripts/guard-production-release.py before', text)
        self.assertIn('python3 scripts/guard-production-release.py after', text)
        self.assertIn('--no-bundle --keep-vars', text)
        self.assertNotIn("  push:", text)
        self.assertNotIn("  pull_request:", text)
        self.assertNotIn("wrangler d1", text)


if __name__ == "__main__":
    unittest.main()
