"""Fail-closed request and artifact checks for the trusted Staging workflow."""
import hashlib
import json
import os
import re
import stat
import subprocess
from pathlib import Path, PurePosixPath
from zipfile import ZipFile

REPO = "Xuyysy/reply-copilot"
PROJECT = "x-reply-helper-staging"
BRANCH = "codex/v0.4-credits"
COMMAND = re.compile(r"/deploy-staging ([0-9a-f]{40}) ([1-9][0-9]{0,19})")


def request(event_name, event, control_issue, ref, repo, permission):
    if repo != REPO or ref != "refs/heads/main":
        return None
    if event_name == "workflow_dispatch":
        inputs = event.get("inputs", {})
        command = COMMAND.fullmatch(f"/deploy-staging {inputs.get('source_sha')} {inputs.get('ci_run_id')}")
    elif event_name == "issue_comment":
        issue, comment = event.get("issue", {}), event.get("comment", {})
        if (event.get("action") != "created" or not re.fullmatch(r"[1-9][0-9]*", control_issue)
                or str(issue.get("number")) != control_issue or "pull_request" in issue
                or not isinstance(comment.get("body"), str)):
            return None
        command = COMMAND.fullmatch(comment["body"])
        if not command:
            return None
        login = comment.get("user", {}).get("login", "")
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]{0,38}(?:\[bot\])?", login):
            return None
        if permission(login) not in {"write", "maintain", "admin"}:
            return None
    else:
        return None
    return command.groups() if command else None


def verify_ci(run, sha, run_id):
    if not (str(run.get("id")) == run_id and run.get("head_sha") == sha
            and run.get("status") == "completed" and run.get("conclusion") == "success"
            and run.get("event") == "push" and run.get("head_repository", {}).get("full_name") == REPO
            and run.get("path") == ".github/workflows/ci.yml"):
        raise ValueError("CI run is not a successful same-repository push at the requested SHA")


def artifact_index(artifacts, sha):
    result = []
    for kind in ("pages", "extension"):
        name = f"staging-{kind}-{sha}"
        matches = [row for row in artifacts if row.get("name") == name]
        if len(matches) != 1:
            raise ValueError(f"Expected exactly one artifact named {name}")
        row = matches[0]
        if (row.get("expired") is not False or not isinstance(row.get("id"), int)
                or not re.fullmatch(r"sha256:[0-9a-f]{64}", row.get("digest") or "")):
            raise ValueError(f"Missing original artifact digest: {name}")
        result.append(row)
    return result


def verify_archive(path, digest):
    with path.open("rb") as stream:
        actual = hashlib.file_digest(stream, "sha256").hexdigest()
    if digest != f"sha256:{actual}":
        raise ValueError("Original GitHub artifact SHA-256 mismatch")


def extract_archive(path, dest):
    dest.mkdir(parents=True, exist_ok=False)
    with ZipFile(path) as z:
        seen = set()
        for info in z.infolist():
            name = PurePosixPath(info.filename)
            if (name.is_absolute() or not name.parts or ".." in name.parts or "\\" in info.filename
                    or name in seen or stat.S_ISLNK(info.external_attr >> 16)):
                raise ValueError("Unsafe archive entry")
            seen.add(name)
        z.extractall(dest)


def deployment_preflight(project, deployments, sha):
    canonical = project.get("canonical_deployment") or {}
    if (project.get("name") != PROJECT or project.get("production_branch") != BRANCH
            or not re.fullmatch(r"[0-9a-f-]{36}", canonical.get("id", ""))):
        raise ValueError("Unexpected Pages target or missing rollback deployment")
    for row in [canonical, *deployments]:
        commit = row.get("deployment_trigger", {}).get("metadata", {}).get("commit_hash")
        if (row.get("environment") == "production" and commit == sha
                and row.get("latest_stage", {}).get("status") == "success"):
            raise ValueError("This source already has a successful Staging Pages deployment")
    return canonical["id"]


def gh_json(*args):
    return json.loads(subprocess.check_output(["gh", "api", *args], text=True))


def main():
    mode = os.environ["RELEASE_CHECK"]
    if mode == "request":
        event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
        validated = request(
            os.environ["GITHUB_EVENT_NAME"], event, os.environ.get("CONTROL_ISSUE", ""),
            os.environ["GITHUB_REF"], os.environ["GITHUB_REPOSITORY"],
            lambda login: gh_json(f"repos/{REPO}/collaborators/{login}/permission")["permission"],
        )
        if validated:
            with open(os.environ["GITHUB_OUTPUT"], "a") as out:
                out.write(f"source_sha={validated[0]}\nci_run_id={validated[1]}\n")
    elif mode == "artifacts":
        sha, run_id = os.environ["SOURCE_SHA"], os.environ["CI_RUN_ID"]
        verify_ci(gh_json(f"repos/{REPO}/actions/runs/{run_id}"), sha, run_id)
        pages = gh_json(f"repos/{REPO}/actions/runs/{run_id}/artifacts?per_page=100", "--paginate", "--slurp")
        selected = artifact_index([row for page in pages for row in page["artifacts"]], sha)
        for row, dest in zip(selected, [Path("web/dist"), Path("dist/ci")], strict=True):
            path = Path(os.environ["RUNNER_TEMP"]) / f"artifact-{row['id']}.zip"
            with path.open("wb") as out:
                subprocess.run(["gh", "api", f"repos/{REPO}/actions/artifacts/{row['id']}/zip"], stdout=out, check=True)
            verify_archive(path, row["digest"])
            extract_archive(path, dest)
            print(f"Verified original artifact {row['id']} {row['digest']}")
    elif mode == "deployment":
        temp = Path(os.environ["RUNNER_TEMP"])
        project = json.loads((temp / "staging-project.json").read_text())["result"]
        deployments = json.loads((temp / "staging-deployments.json").read_text())
        print(deployment_preflight(project, deployments, os.environ["SOURCE_SHA"]))
    else:
        raise ValueError("Unknown validation step")


if __name__ == "__main__":
    main()
