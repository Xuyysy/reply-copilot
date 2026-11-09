import importlib.util
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

script = Path(__file__).resolve().parents[1] / "scripts" / "staging_release.py"
spec = importlib.util.spec_from_file_location("staging_release", script)
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)

SHA = "a" * 40
RUN = "123456"
REF = "refs/heads/main"
ID = "06043f92-d091-4e23-9060-46c0a4ff3f47"


class StagingReleaseTest(unittest.TestCase):
    def comment(self, body=f"/deploy-staging {SHA} {RUN}", permission="write",
                issue=15, ref=REF, repo=release.REPO, **extra):
        event = {"action": "created", "issue": {"number": issue},
                 "comment": {"body": body, "user": {"login": "maintainer"}}}
        if "issue_data" in extra:
            event["issue"] = extra.pop("issue_data")
        event.update(extra)
        return release.request("issue_comment", event, "15", ref, repo, lambda _: permission)

    def test_approved_and_manual(self):
        self.assertEqual(self.comment(), (SHA, RUN))
        self.assertEqual(release.request("workflow_dispatch", {
            "inputs": {"source_sha": SHA, "ci_run_id": RUN}
        }, "", REF, release.REPO, None), (SHA, RUN))

    def test_unauthorized_wrong_issue_and_pr(self):
        for permission in ["read", "triage", "none"]:
            self.assertIsNone(self.comment(permission=permission))
        self.assertIsNone(self.comment(issue=16))
        self.assertIsNone(self.comment(**{"issue_data": {"number": 15, "pull_request": {}}}))
        self.assertIsNone(self.comment(action="edited"))
        self.assertIsNone(self.comment(repo="someone/fork"))
        self.assertIsNone(self.comment(ref="refs/heads/feature"))

    def test_reject_wrong_sha_command_injection_and_wrong_target(self):
        for body in [f"/deploy-staging {SHA[:-1]} {RUN}", f"/deploy-staging {SHA} {RUN}; whoami",
                     f"/deploy-staging {SHA} {RUN}\nwhoami", f"/deploy-production {SHA} {RUN}",
                     f"/deploy-staging {SHA} {RUN} x-reply-helper-production"]:
            self.assertIsNone(self.comment(body=body))

    def test_require_successful_exact_ci(self):
        run = dict(id=int(RUN), head_sha=SHA, status="completed", conclusion="success",
                   event="push", head_repository={"full_name": release.REPO},
                   path=".github/workflows/ci.yml")
        release.verify_ci(run, SHA, RUN)
        for patch in [dict(head_sha="b"*40), dict(conclusion="failure"), dict(event="pull_request"),
                      dict(status="in_progress"), dict(id=0), dict(path=".github/workflows/other.yml"),
                      dict(head_repository={"full_name": "someone/fork"})]:
            with self.assertRaises(ValueError):
                release.verify_ci({**run, **patch}, SHA, RUN)

    def test_reject_duplicate_or_wrong_pages_target(self):
        old = dict(id=ID, environment="production", latest_stage={"status": "success"},
                   deployment_trigger={"metadata": {"commit_hash": "b"*40}})
        project = dict(name=release.PROJECT, production_branch=release.BRANCH, canonical_deployment=old)
        self.assertEqual(release.deployment_preflight(project, [], SHA), ID)
        duplicate = dict(old, deployment_trigger={"metadata": {"commit_hash": SHA}})
        with self.assertRaises(ValueError):
            release.deployment_preflight(project, [duplicate], SHA)
        with self.assertRaises(ValueError):
            release.deployment_preflight(dict(project, name="x-reply-helper-production"), [], SHA)
        with self.assertRaises(ValueError):
            release.deployment_preflight(dict(project, production_branch="main"), [], SHA)

    def test_artifact_digest_and_traversal(self):
        rows = [dict(id=i, name=f"staging-{kind}-{SHA}", expired=False, digest="sha256:"+"a"*64)
                for i, kind in enumerate(["pages", "extension"], 1)]
        self.assertEqual(release.artifact_index(rows, SHA), rows)
        with self.assertRaises(ValueError):
            release.artifact_index([*rows, rows[0]], SHA)
        with self.assertRaises(ValueError):
            release.artifact_index([dict(rows[0], digest=None), rows[1]], SHA)
        with tempfile.TemporaryDirectory() as temp:
            archive = Path(temp) / "artifact.zip"
            with ZipFile(archive, "w") as z:
                z.writestr("../outside", "invalid")
            with self.assertRaises(ValueError):
                release.verify_archive(archive, rows[0]["digest"])
            with self.assertRaises(ValueError):
                release.extract_archive(archive, Path(temp) / "output")


if __name__ == "__main__":
    unittest.main()
