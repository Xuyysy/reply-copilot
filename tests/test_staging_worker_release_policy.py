"""Offline-only checks for the manual staging Worker rollout workflow."""
import pathlib
import unittest
W=pathlib.Path(__file__).resolve().parents[1]/'.github/workflows/staging-worker-inactive-upload.yml'
class StagingWorkerReleasePolicyTests(unittest.TestCase):
 def test_owner_only_exact_release(self):
  s=W.read_text()
  for expected in ("github.actor == 'Xuyysy'","github.ref == 'refs/heads/main'",
                   "environment: staging",'options: ["check", "upload", "deploy"]',
                   "deploy:DEPLOY_STAGING_WORKER", "expected_active_deployment",
                   "test \\"$current\\" = \\"$SOURCE_SHA\\""):
   self.assertIn(expected,s)
 def test_payment_bindings_and_auth_fail_closed(self):
  s=W.read_text()
  for expected in ('PAYMENTS_ENABLED','BOLTUTIL_ADMIN_TEST_ENABLED',
                   "fingerprint \\"$RUNNER_TEMP/staging-new-settings.json\\"",
                   'cmp -s "$RUNNER_TEMP/staging-bindings-before.fingerprint"',
                   'Staging admin auth guard changed','--keep-vars --strict',
                   'if: inputs.mode == \\'upload\\'','if: inputs.mode == \\'deploy\\''):
   self.assertIn(expected,s)
  self.assertNotIn('wrangler d1',s)
  self.assertNotIn('/d1/database/',s)
  self.assertNotIn('  push:',s)
if __name__=='__main__': unittest.main()
