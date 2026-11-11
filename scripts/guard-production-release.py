#!/usr/bin/env python3
"""Read-only Production release guard. No D1 SQL, secrets reads or live mutations."""
import json
import os
import pathlib
import sys
import time
import urllib.request

WORKER = "reply-copilot-api-production"
PAGES = "x-reply-helper-production"
DATABASE = "d9df7d23-9b9c-44ac-a33a-c24474c15691"
REQUIRED_SECRETS = {
    "AI_CONFIG_ENCRYPTION_KEY", "AUTH_HASH_SECRET", "DEEPSEEK_API_KEY",
    "MAIL_API_KEY", "MK99_PID", "MK99_PLATFORM_PUBLIC_KEY",
    "MK99_PRIVATE_KEY", "PASSWORD_PEPPER", "TURNSTILE_SECRET_KEY",
}

def get(path):
    account = os.environ["CLOUDFLARE_ACCOUNT_ID"]
    request = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{account}/{path}",
        headers={"Authorization": "Bearer " + os.environ["CLOUDFLARE_API_TOKEN"]},
    )
    with urllib.request.urlopen(request, timeout=25) as stream:
        payload = json.load(stream)
    if not payload.get("success") or payload.get("result") is None:
        raise RuntimeError("Cloudflare read-only guard request failed")
    return payload["result"]

def check_bindings():
    settings = get(f"workers/scripts/{WORKER}/settings")
    bindings = settings.get("bindings", [])
    live_vars = {b["name"]: b.get("text") for b in bindings if b.get("type") == "plain_text"}
    expected = json.loads(pathlib.Path("release/worker-config.json").read_text())["vars"]
    for key, value in expected.items():
        if live_vars.get(key) != str(value):
            raise RuntimeError("Live Production variable mismatch: " + key)
    if live_vars.get("PAYMENTS_ENABLED") != "1" or live_vars.get("ADMIN_PORTAL_ENABLED") != "1":
        raise RuntimeError("Production payments or admin disabled")
    secrets = {b["name"] for b in bindings if b.get("type") == "secret_text"}
    if not REQUIRED_SECRETS.issubset(secrets):
        raise RuntimeError("One or more required Production secret bindings missing")
    databases = [b for b in bindings if b.get("type") == "d1" and b.get("name") == "DB"]
    if len(databases) != 1 or databases[0].get("id") != DATABASE:
        raise RuntimeError("Production D1 binding mismatch")
    if settings.get("compatibility_date") != "2026-10-14":
        raise RuntimeError("Production runtime compatibility changed")
    return {"vars": live_vars, "secrets": sorted(secrets),
            "binding_names": sorted((b.get("name"), b.get("type")) for b in bindings)}

def live_id(target):
    if target == "worker":
        deployments = get(f"workers/scripts/{WORKER}/deployments")
        d = deployments["deployments"][0]
        versions = d.get("versions", [])
        if len(versions) != 1 or versions[0].get("percentage") != 100:
            raise RuntimeError("Production Worker not at 100% single version")
        return versions[0]["version_id"], d["id"]
    if target == "pages":
        project = get(f"pages/projects/{PAGES}")
        d = project.get("canonical_deployment") or {}
        if d.get("latest_stage", {}).get("status") != "success":
            raise RuntimeError("Production Pages canonical deployment not successful")
        return d["id"], d["id"]
    raise ValueError("Unsupported production target")

def main():
    stage = sys.argv[1]
    target = os.environ["TARGET"]
    expected = os.environ["EXPECTED_CURRENT"]
    snapshot = pathlib.Path(os.environ["RUNNER_TEMP"]) / "production-release-snapshot.json"
    if stage == "before":
        current = check_bindings()
        active, deployment = live_id(target)
        if active != expected:
            raise RuntimeError("Production changed after approval; refused stale release")
        pinned_deployment = os.environ.get("EXPECTED_DEPLOYMENT", "")
        if pinned_deployment and (target != "worker" or deployment != pinned_deployment):
            raise RuntimeError("Production Worker deployment ID changed after explicit API-origin approval")
        snapshot.write_text(json.dumps({
            "bindings": current, "previous": active,
            "previousDeployment": deployment, "target": target,
        }))
        print(f"PASS: current Production {target} matches approved rollback point; all bindings checked")
    elif stage == "after":
        before = json.loads(snapshot.read_text())
        if before["target"] != target:
            raise RuntimeError("Production release target unexpectedly changed")
        # Cloudflare Pages may need time to finish building, and the Worker
        # versions endpoint may briefly report the previous active version.
        # Never conceal a variable/secret/D1 drift while waiting.
        active = deployment = None
        for attempt in range(15):
            current = check_bindings()
            if current != before["bindings"]:
                raise RuntimeError("ALERT: Production variables, secrets or bindings changed")
            try:
                active, deployment = live_id(target)
            except RuntimeError as error:
                if target != "pages" or "canonical deployment not successful" not in str(error):
                    raise
                if attempt == 14:
                    raise
            else:
                if active != before["previous"]:
                    break
            if attempt == 14:
                raise RuntimeError("New Production release not active within postflight window")
            time.sleep(5)
        print(f"PASS: new Production {target} is active, all vars/secrets/D1 preserved")
        print(f"New active ID: {active}")
        print(f"New deployment ID: {deployment}")
        print(f"Previous active ID: {before['previous']}")
        print(f"Previous deployment ID: {before['previousDeployment']}")
    else:
        raise ValueError("Expected before or after")

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("FAIL CLOSED: " + str(error), file=sys.stderr)
        sys.exit(1)
