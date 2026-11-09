"""Package the CI-built Chrome candidate and record its exact provenance."""
import hashlib
import json
import subprocess
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root = Path("dist/production")
manifest = json.loads((root / "manifest.json").read_text())
source = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
identity = json.loads(Path("config/extension-store-identity.json").read_text())
assert identity["id"] == "fgfjajofkapebgphfidblngcjomkbdaj" and manifest["key"]
assert manifest["version"] == "0.3.4"
assert manifest["host_permissions"] == ["https://api.x-reply-helper.top/*"]
assert manifest["externally_connectable"] == {"matches": ["https://app.x-reply-helper.top/*"]}
assert set(manifest["permissions"]) == {"contextMenus", "storage", "sidePanel", "clipboardWrite"}
assert not (root / "staging").exists()
output = Path("dist/production-rc")
output.mkdir(parents=True, exist_ok=True)
archive = output / "reply-copilot-production-0.3.4.zip"
with ZipFile(archive, "w", ZIP_DEFLATED) as package:
    for file in sorted(root.rglob("*")):
        if file.is_file():
            assert not file.is_symlink()
            package.write(file, file.relative_to(root))
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(output / "provenance.json").write_text(json.dumps({
    "sourceSha": source, "extensionId": identity["id"], "version": manifest["version"],
    "permissions": manifest["permissions"], "hostPermissions": manifest["host_permissions"],
    "externallyConnectable": manifest["externally_connectable"], "sha256": digest,
}, indent=2) + "\n")
