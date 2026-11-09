#!/usr/bin/env python3
"""Validate immutable Production build artifacts. Never deploys or queries D1."""
import argparse
import hashlib
import json
import pathlib
import re
import sys

SHA = re.compile(r"^[0-9a-f]{40}$")
DIGEST = re.compile(r"^[0-9a-f]{64}$")
EXPECTED = {
    "channel": "production",
    "api": "https://api.x-reply-helper.top",
    "website": "https://app.x-reply-helper.top",
    "worker": "reply-copilot-api-production",
    "pages": "x-reply-helper-production",
    "extensionId": "fgfjajofkapebgphfidblngcjomkbdaj",
}
DB_ID = "d9df7d23-9b9c-44ac-a33a-c24474c15691"

def verify(folder: pathlib.Path, source_sha: str):
    if not SHA.fullmatch(source_sha):
        raise ValueError("Expected a full 40-character Git source SHA")
    root = folder.resolve(strict=True)
    manifest = json.loads((root / "release-manifest.json").read_text())
    if manifest.get("schema") != 1 or manifest.get("sourceSha") != source_sha:
        raise ValueError("Provenance schema or SHA mismatch")
    for field, expected in EXPECTED.items():
        if manifest.get(field) != expected:
            raise ValueError(f"Wrong Production artifact {field}")
    files = manifest.get("files")
    if not isinstance(files, dict) or len(files) != manifest.get("fileCount") or not 20 < len(files) < 600:
        raise ValueError("Bad file inventory")
    actual = {}
    for item in root.rglob("*"):
        if item.is_symlink():
            raise ValueError("Symlink in artifact")
        if item.is_file():
            relative = item.relative_to(root).as_posix()
            if relative == "release-manifest.json":
                continue
            actual[relative] = hashlib.sha256(item.read_bytes()).hexdigest()
    if actual != files or any(not DIGEST.fullmatch(value) for value in files.values()):
        raise ValueError("Files missing, added or modified since successful CI")
    if not (root / "worker/index.js").is_file():
        raise ValueError("Missing precompiled Worker bundle")
    if not (root / "pages/index.html").is_file() or not (root / "pages/admin/index.html").is_file():
        raise ValueError("Missing Production Pages")
    if any(p.name in ("_worker.js", "_routes.json") for p in (root / "pages").rglob("*")):
        raise ValueError("Unexpected Pages Worker/Functions")
    pages_text = "\n".join(p.read_text(errors="replace") for p in (root / "pages").rglob("*.js"))
    if EXPECTED["api"] not in pages_text or "api-staging.x-reply-helper.top" in pages_text:
        raise ValueError("Incorrect API origin in Pages output")
    config = json.loads((root / "worker-config.json").read_text())
    vars_ = config.get("vars", {})
    if config.get("name") != EXPECTED["worker"] or vars_.get("ENVIRONMENT") != "production":
        raise ValueError("Wrong Worker target")
    for name, expected in {
        "PAYMENTS_ENABLED": "1",
        "ADMIN_PORTAL_ENABLED": "1",
        "AI_MODE": "production",
        "API_ORIGIN": EXPECTED["api"],
        "WEB_ORIGIN": EXPECTED["website"],
        "EXTENSION_ORIGIN": "chrome-extension://" + EXPECTED["extensionId"],
        "XIAODOU_WEBHOOKS_ENABLED": "1",
    }.items():
        if vars_.get(name) != expected:
            raise ValueError(f"Unsafe Production variable {name}")
    dbs = config.get("d1_databases", [])
    if len(dbs) != 1 or dbs[0].get("binding") != "DB" or dbs[0].get("database_id") != DB_ID:
        raise ValueError("Unexpected Production D1 binding")
    if config.get("workers_dev") is not False or config.get("routes") != [{"pattern":"api.x-reply-helper.top","custom_domain":True}]:
        raise ValueError("Unexpected Worker route")
    if config.get("triggers", {}).get("crons") != ["0 3 * * *"]:
        raise ValueError("Unexpected cron")
    if config.get("observability", {}).get("redact_query_string") is not True or config.get("observability", {}).get("logs", {}).get("invocation_logs") is not False:
        raise ValueError("Unsafe logging policy")
    ext = json.loads((root / "extension/provenance.json").read_text())
    if ext.get("sourceSha") != source_sha or ext.get("extensionId") != EXPECTED["extensionId"]:
        raise ValueError("Incorrect Chrome source provenance")
    archive = ext.get("archive", "")
    if not isinstance(archive, str) or not re.fullmatch(r"reply-copilot-production-\\d+\\.\\d+\\.\\d+(?:\\.\\d+)?\\.zip", archive):
        raise ValueError("Invalid Chrome ZIP filename in provenance")
    zip_file = root / "extension" / archive
    if not zip_file.is_file() or hashlib.sha256(zip_file.read_bytes()).hexdigest() != ext.get("sha256"):
        raise ValueError("Chrome ZIP digest mismatch")
    return len(actual)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("folder", type=pathlib.Path)
    parser.add_argument("sha")
    args = parser.parse_args()
    try:
        total = verify(args.folder, args.sha)
    except Exception as error:
        print(f"FAIL CLOSED: {error}", file=sys.stderr)
        sys.exit(1)
    print(f"PASS: {total} immutable Production files verified for {args.sha}")
