#!/usr/bin/env python3
"""Build the next Production Chrome ZIP from a pinned source checkout (never publish)."""
import hashlib
import json
import pathlib
import re
import subprocess
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

root = pathlib.Path(__file__).resolve().parent.parent
ext = root / "dist/production"
out = root / "dist/production-ci/extension"
sha = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
assert re.fullmatch(r"[0-9a-f]{40}", sha)
manifest = json.loads((ext / "manifest.json").read_text())
identity = json.loads((root / "config/extension-store-identity.json").read_text())
version = manifest.get("version", "")
assert re.fullmatch(r"\d+\.\d+\.\d+(?:\.\d+)?", version), "Bad Chrome version"
assert identity["id"] == "fgfjajofkapebgphfidblngcjomkbdaj"
assert manifest.get("key") == identity["publicKey"] and manifest.get("key"), "Missing Store public key"
assert manifest["manifest_version"] == 3
assert manifest["host_permissions"] == ["https://api.x-reply-helper.top/*"]
assert manifest["externally_connectable"] == {"matches": ["https://app.x-reply-helper.top/*"]}
assert set(manifest["permissions"]) == {"contextMenus", "storage", "sidePanel", "clipboardWrite"}
assert not (ext / "staging").exists()
files = sorted((p for p in ext.rglob("*") if p.is_file()), key=lambda p: p.relative_to(ext).as_posix())
assert 10 < len(files) < 500
assert sum(p.stat().st_size for p in files) < 20_000_000
assert not any(p.is_symlink() for p in ext.rglob("*"))
out.mkdir(parents=True, exist_ok=True)
name = f"reply-copilot-production-{version}.zip"
with ZipFile(out / name, "w", ZIP_DEFLATED, compresslevel=9) as archive:
    for p in files:
        zi = ZipInfo(p.relative_to(ext).as_posix(), date_time=(2020, 1, 1, 0, 0, 0))
        zi.create_system = 3
        zi.external_attr = 0o100644 << 16
        zi.compress_type = ZIP_DEFLATED
        archive.writestr(zi, p.read_bytes(), compress_type=ZIP_DEFLATED, compresslevel=9)
digest = hashlib.sha256((out / name).read_bytes()).hexdigest()
(out / "provenance.json").write_text(json.dumps({
    "sourceSha":sha, "extensionId":identity["id"],"version":version,
    "archive":name,"permissions":manifest["permissions"],
    "hostPermissions":manifest["host_permissions"],
    "externallyConnectable":manifest["externally_connectable"],"sha256":digest,
},sort_keys=True,indent=2) + "\n")
print(f"Production Chrome ZIP {name}: {digest} source {sha}")
