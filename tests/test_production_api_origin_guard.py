"""Offline-only regression checks for an explicitly approved Production Script-API source takeover."""
import importlib.util
import json
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



class ProductionPostflightTests(unittest.TestCase):
    @staticmethod
    def bindings():
        return {
            "vars": {"ADMIN_PORTAL_ENABLED": "1", "PAYMENTS_ENABLED": "1"},
            "secrets": ["AUTH_HASH_SECRET"],
            "binding_names": [
                ["ADMIN_PORTAL_ENABLED", "plain_text"],
                ["AUTH_HASH_SECRET", "secret_text"],
                ["DB", "d1"],
                ["PAYMENTS_ENABLED", "plain_text"],
            ],
        }

    def run_after(self, *, target="worker", binding_reads=None, live_reads=None):
        stable = self.bindings()
        previous = "old-version" if target == "worker" else "old-pages"
        with tempfile.TemporaryDirectory() as folder:
            snapshot = pathlib.Path(folder) / "production-release-snapshot.json"
            snapshot.write_text(json.dumps({
                "target": target,
                "bindings": stable,
                "previous": previous,
                "previousDeployment": "old-deployment",
            }))
            with mock.patch.dict(os.environ, {
                "TARGET": target,
                "EXPECTED_CURRENT": previous,
                "RUNNER_TEMP": folder,
            }, clear=False), mock.patch.object(
                sys, "argv", [str(GUARD_PATH), "after"]
            ), mock.patch.object(
                guard, "check_bindings",
                side_effect=binding_reads if binding_reads is not None else [stable],
            ) as check, mock.patch.object(
                guard, "live_id",
                side_effect=live_reads if live_reads is not None else [("new-version", "new-deployment")],
            ) as live, mock.patch.object(
                guard.time, "sleep",
            ) as sleep:
                guard.main()
                return check.call_count, live.call_count, sleep.call_count

    def test_actual_worker_binding_snapshot_has_json_stable_shape(self):
        settings = {
            "bindings": [
                {"name": "DB", "type": "d1", "id": guard.DATABASE},
                {"name": "PAYMENTS_ENABLED", "type": "plain_text", "text": "1"},
                {"name": "ADMIN_PORTAL_ENABLED", "type": "plain_text", "text": "1"},
                *({"name": name, "type": "secret_text"} for name in guard.REQUIRED_SECRETS),
            ],
            "compatibility_date": "2026-10-14",
        }
        config = {"vars": {"PAYMENTS_ENABLED": "1", "ADMIN_PORTAL_ENABLED": "1"}}
        with mock.patch.object(guard, "get", return_value=settings), mock.patch.object(
            pathlib.Path, "read_text", return_value=json.dumps(config)
        ):
            actual = guard.check_bindings()
        self.assertEqual(actual, json.loads(json.dumps(actual)))
        self.assertTrue(all(isinstance(entry, list) for entry in actual["binding_names"]))

    def test_worker_postflight_passes_with_equal_json_snapshots(self):
        self.assertEqual(self.run_after(), (1, 1, 0))

    def test_worker_postflight_recovers_from_transient_binding_drift(self):
        wrong = self.bindings()
        wrong["vars"]["PAYMENTS_ENABLED"] = "0"
        self.assertEqual(
            self.run_after(binding_reads=[wrong, self.bindings()]),
            (2, 1, 1),
        )

    def test_pages_postflight_waits_for_new_canonical_deployment(self):
        self.assertEqual(
            self.run_after(
                target="pages",
                binding_reads=[self.bindings(), self.bindings()],
                live_reads=[("old-pages", "old-deployment"), ("new-pages", "new-deployment")],
            ),
            (2, 2, 1),
        )

    def test_persistent_variable_drift_fails_closed_and_no_values_leak(self):
        wrong = self.bindings()
        wrong["vars"]["PAYMENTS_ENABLED"] = "DO_NOT_LOG"
        with self.assertRaisesRegex(RuntimeError, r"binding drift.*PAYMENTS_ENABLED") as failure:
            self.run_after(binding_reads=[wrong] * 15)
        self.assertNotIn("DO_NOT_LOG", str(failure.exception))

    def test_persistent_secret_drift_fails_closed(self):
        wrong = self.bindings()
        wrong["secrets"] = []
        with self.assertRaisesRegex(RuntimeError, "secret binding names removed: AUTH_HASH_SECRET"):
            self.run_after(binding_reads=[wrong] * 15)

    def test_settings_validator_failure_cannot_be_retried_into_success_without_recovery(self):
        with self.assertRaisesRegex(RuntimeError, "Production D1 binding mismatch"):
            self.run_after(binding_reads=[RuntimeError("Production D1 binding mismatch")] * 15)


if __name__ == "__main__":
    unittest.main()
