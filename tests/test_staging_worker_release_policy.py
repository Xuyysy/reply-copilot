"""Offline-only checks for manual Staging Worker rollout; no Cloudflare calls."""
import pathlib
import unittest

WORKFLOW=pathlib.Path(__file__).resolve().parents[1]/'.github/workflows/staging-worker-inactive-upload.yml'

class StagingWorkerReleasePolicyTests(unittest.TestCase):
    def test_owner_only_exact_release(self):
        source=WORKFLOW.read_text()
        for expected in (
            "github.actor == 'Xuyysy'",
            "github.ref == 'refs/heads/main'",
            "environment: staging",
            'options: ["check", "upload", "deploy"]',
            "deploy:DEPLOY_STAGING_WORKER",
            "expected_active_deployment",
            'test "$current" = "$SOURCE_SHA"',
        ):
            self.assertIn(expected,source)

    def test_payment_bindings_and_auth_fail_closed(self):
        source=WORKFLOW.read_text()
        for expected in (
            "PAYMENTS_ENABLED", "PASSWORD_FREE_TINY_CPU_ENABLED",
            'fingerprint "$RUNNER_TEMP/staging-new-settings.json"',
            'cmp -s "$RUNNER_TEMP/staging-bindings-before.fingerprint"',
            "Staging admin auth guard changed",
            "--keep-vars --strict",
            "if: inputs.mode == 'upload'",
            "if: inputs.mode == 'deploy'",
        ):
            self.assertIn(expected,source)
        self.assertNotIn("wrangler d1",source)
        self.assertNotIn("/d1/database/",source)
        self.assertNotIn("  push:",source)
        self.assertNotIn("  schedule:",source)

if __name__=="__main__":
    unittest.main()
