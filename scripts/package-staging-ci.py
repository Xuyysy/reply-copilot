#!/usr/bin/env python3
"""Reproducible Staging extension ZIP + Web checksums. Never deploys."""

import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parent.parent
EXT = ROOT / "dist/staging"
WEB = ROOT / "web/dist"
OUT = ROOT / "dist/ci"
SITE = "https://staging.x-reply-helper.top"
API = "https://api-staging.x-reply-helper.top"
EXT_ID = "kaaehkpihjenlhjjfjcopkjhegmfmchk"
PERMISSIONS = {"contextMenus", "storage", "sidePanel", "clipboardWrite"}


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def files(folder):
    return sorted((p for p in folder.rglob("*") if p.is_file()), key=lambda p: p.relative_to(folder).as_posix())


def main():
    sha = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    if not re.fullmatch(r"[0-9a-f]{40}", sha) or (os.environ.get("GITHUB_SHA") and os.environ["GITHUB_SHA"] != sha):
        raise SystemExit("Build source SHA and checkout mismatch")
    if not EXT.is_dir() or not WEB.is_dir():
        raise SystemExit("Staging extension and Staging Pages builds are required")
    manifest = json.loads((EXT / "manifest.json").read_text())
    runtime = (EXT / "config/runtime.js").read_text()
    if manifest.get("key") or manifest.get("manifest_version") != 3:
        raise SystemExit("Staging identity or manifest mismatch")
    if manifest.get("host_permissions") != [API + "/*"] or set(manifest.get("permissions", [])) != PERMISSIONS:
        raise SystemExit("Staging permission expansion or wrong API")
    if manifest.get("background", {}).get("service_worker") != "staging/service-worker.js":
        raise SystemExit("Staging service worker missing")
    if not all(v in runtime for v in ['channel: "staging"', f'websiteUrl: "{SITE}"', f'hostedApiUrl: "{API}"']):
        raise SystemExit("Staging runtime origins mismatch")
    if not (EXT / "content/momentum.css").is_file():
        raise SystemExit("Momentum UI missing")
    if (EXT / "sidepanel/performance-panel.js").exists() or (EXT / "staging/momentum-panel.js").exists():
        raise SystemExit("Retired test-only UI in release candidate")
    if not (WEB / "admin/index.html").is_file():
        raise SystemExit("Staging admin page missing")
    if not any(API in p.read_text(errors="replace") for p in WEB.rglob("*.js")):
        raise SystemExit("Staging API not found in Web build")
    if not any("challenges.cloudflare.com/turnstile/v0/api.js" in p.read_text(errors="replace") for p in WEB.rglob("*.html")):
        raise SystemExit("Staging Turnstile not found")
    if any(p.is_symlink() for p in EXT.rglob("*")):
        raise SystemExit("Symlinks are forbidden in staging extension ZIP")

    OUT.mkdir(parents=True, exist_ok=True)
    (EXT / "build-info.json").write_text(json.dumps({
        "sourceSha": sha, "channel": "staging", "expectedExtensionId": EXT_ID,
        "version": manifest["version"]}, indent=2) + "\n")
    entries = files(EXT)
    if len(entries) > 500 or sum(p.stat().st_size for p in entries) > 20_000_000:
        raise SystemExit("Package exceeds existing safe installer limits")

    zip_path = OUT / f"reply-copilot-staging-{sha[:7]}.zip"
    with ZipFile(zip_path, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
        for p in entries:
            item = ZipInfo(p.relative_to(EXT).as_posix(), date_time=(2020, 1, 1, 0, 0, 0))
            item.compress_type = ZIP_DEFLATED
            item.external_attr = 0o100644 << 16
            item.create_system = 3
            archive.writestr(item, p.read_bytes(), compress_type=ZIP_DEFLATED, compresslevel=9)

    digest = sha256(zip_path)
    (OUT / (zip_path.name + ".sha256")).write_text(f"{digest}  {zip_path.name}\n")
    web_files = [f"{sha256(p)}  {p.relative_to(ROOT).as_posix()}" for p in files(WEB)]
    (OUT / "web-files.sha256").write_text("\n".join(web_files) + "\n")
    (OUT / "release-manifest.json").write_text(json.dumps({
        "sourceSha": sha, "channel": "staging", "extensionId": EXT_ID,
        "extensionVersion": manifest["version"], "extensionZip": zip_path.name,
        "extensionZipSha256": digest, "pagesProject": "x-reply-helper-staging",
        "pagesDomain": SITE, "stagingApi": API, "webFileCount": len(web_files),
        "extensionFileCount": len(entries)
    }, indent=2) + "\n")
    print(f"Staging ZIP: {zip_path}\nSHA-256: {digest}\nSource SHA: {sha}")


if __name__ == "__main__":
    main()
