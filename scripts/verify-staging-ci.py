#!/usr/bin/env python3
"""Verify CI provenance and downloaded Web build before any Staging deployment."""

import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web/dist"
API = "https://api-staging.x-reply-helper.top"
SITE = "https://staging.x-reply-helper.top"


def main():
    release = json.loads((ROOT / "dist/ci/release-manifest.json").read_text())
    sha = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    if sha != os.environ.get("SOURCE_SHA") or release.get("sourceSha") != sha:
        raise SystemExit("Downloaded artifact does not match approved source SHA")
    if (release.get("channel"), release.get("pagesProject"), release.get("pagesDomain"),
        release.get("stagingApi"), release.get("extensionId")) != (
        "staging", "x-reply-helper-staging", SITE, API, "kaaehkpihjenlhjjfjcopkjhegmfmchk"):
        raise SystemExit("Artifact contains an unexpected deployment target")
    if not (WEB / "admin/index.html").is_file():
        raise SystemExit("Missing Staging admin route")
    if not any(API in p.read_text(errors="replace") for p in WEB.rglob("*.js")):
        raise SystemExit("Downloaded JavaScript has the wrong Staging API")
    if not any("challenges.cloudflare.com/turnstile/v0/api.js" in p.read_text(errors="replace")
               for p in WEB.rglob("*.html")):
        raise SystemExit("Staging Turnstile widget missing")
    print("Verified Staging Pages environment, admin page and approved source SHA")


if __name__ == "__main__":
    main()
